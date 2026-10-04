// =====================================================================
// Edge Function: api  (미니앱의 문지기)
// 1) 텔레그램 initData 서명 검증 → 2) 인물·활성 여부 확인
// 3) 직책 등급으로 권한 확인 → 4) DB 읽기·쓰기 (서버 키, 수정자 기록)
//
// 요청 형식: POST { action: "출결 등 기능 이름", payload: {...} }
// 헤더:     x-telegram-init-data: Telegram.WebApp.initData
//
// 직책 기록 규칙: 조장도 org_unit은 '팀'으로 기록하고, 어느 조인지는 조 배정으로 표현한다.
// =====================================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// 미니앱 주소. 끝에 '/'나 경로가 붙어 있어도 'https://아이디.github.io' 형태로 정리해서 씀
const ALLOWED_ORIGIN = (() => {
  const raw = (Deno.env.get("ALLOWED_ORIGIN") ?? "*").trim();
  if (raw === "*") return raw;
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ""); }
})();
const INIT_DATA_MAX_AGE_SEC = 60 * 60 * 24; // initData 유효 시간 24시간

// 직책 등급 (positions 테이블과 맞출 것)
const RANK = {
  MEMBER: 10,
  GROUP_LEADER: 20,
  INSTRUCTOR: 30,
  TEAM_LEADER: 40,
};

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-telegram-init-data, x-telegram-login",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;   // 오류와 함께 앱에 보낼 추가 정보 (예: 등록 안 된 사람의 텔레그램 번호)
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Supabase 응답에서 에러면 던지고, 아니면 data 반환
function must<T = any>(res: { data: T; error: any }): T {
  if (res.error) throw res.error;
  return res.data;
}


// ---------------------------------------------------------------------
// 텔레그램 initData 검증
// ---------------------------------------------------------------------
const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyInitData(initData: string) {
  if (!initData) throw new HttpError(401, "텔레그램 인증 정보가 없습니다");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "텔레그램 인증 정보가 올바르지 않습니다");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = await hmac(enc.encode("WebAppData"), BOT_TOKEN);
  const calc = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(calc, hash)) throw new HttpError(401, "텔레그램 인증에 실패했습니다");

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SEC) {
    throw new HttpError(401, "세션이 만료되었습니다. 미니앱을 다시 열어주세요");
  }

  const user = JSON.parse(params.get("user") ?? "null");
  if (!user?.id) throw new HttpError(401, "사용자 정보가 없습니다");
  return user as { id: number; first_name?: string; username?: string };
}

// PC 브라우저: 텔레그램 로그인 버튼(Login Widget)이 준 정보 검증
// (미니앱과 달리 비밀키 = SHA-256(봇 토큰))
const LOGIN_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 브라우저 로그인 유지 7일
async function verifyLoginWidget(raw: string) {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "로그인 정보가 올바르지 않습니다");
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(BOT_TOKEN)));
  const calc = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(calc, hash)) throw new HttpError(401, "텔레그램 로그인 확인에 실패했습니다. 다시 로그인해주세요");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > LOGIN_MAX_AGE_SEC) {
    throw new HttpError(401, "로그인이 만료되었어요. 다시 로그인해주세요");
  }
  const id = Number(params.get("id"));
  if (!id) throw new HttpError(401, "사용자 정보가 없습니다");
  return { id };
}

// 로그인 버튼에 쓸 봇 아이디 (공개 정보)
let botUsername = "";
async function getBotUsername() {
  if (botUsername) return botUsername;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then((x) => x.json());
  botUsername = r?.result?.username ?? "";
  return botUsername;
}


// ---------------------------------------------------------------------
// 권한 도우미
// ---------------------------------------------------------------------
type Ctx = { db: any; me: { id: string; name: string }; payload: any };

async function rankIn(ctx: Ctx, unitId: string): Promise<number> {
  return must(await ctx.db.rpc("effective_rank", { p_person: ctx.me.id, p_unit: unitId })) ?? 0;
}

async function requireRank(ctx: Ctx, unitId: string, min: number) {
  if ((await rankIn(ctx, unitId)) < min) throw new HttpError(403, "권한이 없습니다");
}

async function requirePin(ctx: Ctx) {
  const ok = must(await ctx.db.rpc("is_pin_unlocked", { p_person: ctx.me.id }));
  if (!ok) throw new HttpError(423, "PIN 입력이 필요합니다");
}

async function logAccess(ctx: Ctx, action: string, target_table?: string, target_id?: string, detail?: unknown) {
  await ctx.db.from("access_log").insert({
    actor_id: ctx.me.id, action, target_table, target_id, detail,
  });
}

// payload에서 허용된 칸만 골라내기
function pick(obj: any, keys: string[]) {
  const out: any = {};
  for (const k of keys) if (obj && k in obj) out[k] = obj[k];
  return out;
}

async function sessionTeam(ctx: Ctx, sessionId: string): Promise<string> {
  const s = must(await ctx.db.from("meeting_sessions").select("team_id").eq("id", sessionId).maybeSingle());
  if (!s) throw new HttpError(404, "모임 회차를 찾을 수 없습니다");
  return s.team_id;
}


// ----- 날짜·주간 도우미 (날짜는 'YYYY-MM-DD' 문자열, UTC 기준 계산) -----
function addDaysStr(s: string, n: number) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekDates(ws: string) { return [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysStr(ws, i)); }
function checkMonday(s: any): string {
  if (typeof s !== "string" || !/^\d{4}-\d\d-\d\d$/.test(s) || new Date(s + "T00:00:00Z").getUTCDay() !== 1) {
    throw new HttpError(400, "주 시작일(월요일)이 올바르지 않습니다");
  }
  return s;
}
async function weeklyHours(ctx: Ctx) {
  const r = must(await ctx.db.from("app_settings").select("value").eq("key", "weekly_hours").maybeSingle());
  const v = r?.value ?? {};
  const from = Math.max(0, Math.min(23, Number(v.from ?? 8)));
  const to = Math.max(from + 1, Math.min(24, Number(v.to ?? 24)));
  return { from, to };
}
function groupFixed(rows: any[]) {
  const map = new Map<string, any>();
  for (const r of rows ?? []) {
    const start = String(r.start_time).slice(0, 5), end = String(r.end_time).slice(0, 5);
    const k = `${r.title}|${start}|${end}`;
    const cur = map.get(k) ?? { title: r.title, weekdays: [] as number[], start, end };
    if (!cur.weekdays.includes(r.weekday)) cur.weekdays.push(r.weekday);
    map.set(k, cur);
  }
  return [...map.values()].map((f) => ({ ...f, weekdays: f.weekdays.sort((a: number, b: number) => ((a + 6) % 7) - ((b + 6) % 7)) }));
}

// 내가 접근할 수 있는 운영 중인 팀 [{ id, name, rank }]
async function myTeams(ctx: Ctx) {
  const units: any[] = must(await ctx.db.from("org_units").select("id,name,unit_type,parent_id,ended_on"));
  const byParent = new Map<string, any[]>();
  for (const u of units) {
    if (!u.parent_id) continue;
    if (!byParent.has(u.parent_id)) byParent.set(u.parent_id, []);
    byParent.get(u.parent_id)!.push(u);
  }
  const unitById = new Map(units.map((u) => [u.id, u]));
  const today = new Date().toISOString().slice(0, 10);
  const positions: any[] = must(await ctx.db.from("position_history")
    .select("org_unit_id, positions(name, rank)")
    .eq("person_id", ctx.me.id)
    .lte("started_on", today)
    .or(`ended_on.is.null,ended_on.gte.${today}`));
  const teamIds = new Set<string>();
  const collect = (unitId: string) => {
    const u = unitById.get(unitId);
    if (!u || u.ended_on) return;
    if (u.unit_type === "팀") { teamIds.add(u.id); return; }
    for (const c of byParent.get(unitId) ?? []) collect(c.id);
  };
  for (const p of positions) collect(p.org_unit_id);
  const teams = [];
  for (const id of teamIds) teams.push({ id, name: unitById.get(id).name, rank: await rankIn(ctx, id) });
  return { teams, positions, unitById };
}
// 녹음 관계자 규칙 (설정값 recording_access). 예: 성우팀 교관(30) 이상, 엔지니어팀 팀장(40) 이상
async function recordingRules(ctx: Ctx): Promise<{ team: string; min_rank: number }[]> {
  const r = must(await ctx.db.from("app_settings").select("value").eq("key", "recording_access").maybeSingle());
  return Array.isArray(r?.value) ? r.value : [{ team: "성우팀", min_rank: 30 }, { team: "엔지니어팀", min_rank: 40 }];
}
// 녹음 관계자인지 (녹음요청·일정·가능시간 모아보기 등 녹음 관련 열람 기준)
async function isRecordingStaff(ctx: Ctx, teams?: any[]) {
  const rules = await recordingRules(ctx);
  const mine = teams ?? (await myTeams(ctx)).teams;
  return rules.some((r) => mine.some((t: any) => t.name === r.team && t.rank >= r.min_rank));
}
// 가능시간 모아보기에서 볼 수 있는 팀:
// 내가 조장 이상인 팀 + (녹음 관계자라면) 녹음 관련 팀 전체
async function boardTeams(ctx: Ctx) {
  const { teams, unitById } = await myTeams(ctx);
  const out = new Map<string, any>();
  for (const t of teams) if (t.rank >= RANK.GROUP_LEADER) out.set(t.id, t);
  const rules = await recordingRules(ctx);
  const staff = rules.some((r) => teams.some((t: any) => t.name === r.team && t.rank >= r.min_rank));
  if (staff) {
    const names = rules.map((r) => r.team);
    for (const u of unitById.values()) {
      if (u.unit_type === "팀" && !u.ended_on && names.includes(u.name) && !out.has(u.id)) {
        out.set(u.id, { id: u.id, name: u.name, rank: 0 });
      }
    }
  }
  return [...out.values()];
}

// ----- 공지·과제·체크인 도우미 -----
// 내가 지금 속한 조 id 목록
async function myGroupIds(ctx: Ctx): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = must(await ctx.db.from("group_assignments").select("group_unit_id")
    .eq("person_id", ctx.me.id).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
  return rows.map((r) => r.group_unit_id);
}
// 대상이 특정 조로 정해진 글은 그 조 사람과 조장 이상만
function visibleToMe(row: any, rank: number, groups: string[]) {
  return rank >= RANK.GROUP_LEADER || !row.target_unit_id || groups.includes(row.target_unit_id);
}
// 팀 + 그 위 과 (과 전체 공지용)
async function teamAndSection(ctx: Ctx, teamId: string): Promise<string[]> {
  const u = must(await ctx.db.from("org_units").select("parent_id").eq("id", teamId).maybeSingle());
  return [teamId, u?.parent_id].filter(Boolean);
}
// 공지를 올릴 단위 + 권한 확인: 팀 공지는 그 팀 교관 이상, 과 전체(scope "section")는 팀장 이상
async function noticeUnit(ctx: Ctx, p: any): Promise<string> {
  if (p.scope !== "section") { await requireRank(ctx, p.team_id, RANK.INSTRUCTOR); return p.team_id; }
  await requireRank(ctx, p.team_id, RANK.TEAM_LEADER);
  const u = must(await ctx.db.from("org_units").select("parent_id").eq("id", p.team_id).maybeSingle());
  if (!u?.parent_id) throw new HttpError(400, "상위 과를 찾을 수 없습니다");
  return u.parent_id;
}
// 글이 속한 팀
async function ownerTeam(ctx: Ctx, table: string, id: string): Promise<string> {
  const r = must(await ctx.db.from(table).select("team_id").eq("id", id).maybeSingle());
  if (!r) throw new HttpError(404, "대상을 찾을 수 없습니다");
  return r.team_id;
}
// 사람 id → 이름
async function nameMap(ctx: Ctx, ids: any[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map<string, string>();
  const rows: any[] = must(await ctx.db.from("people").select("id, name").in("id", uniq)) ?? [];
  return new Map(rows.map((r) => [r.id, r.name]));
}
// 공지 고치기·지우기 권한: 쓴 사람 또는 그 단위에서 교관 이상
async function editableNotice(ctx: Ctx, id: string) {
  const row = must(await ctx.db.from("notices").select("id, team_id, created_by").eq("id", id).maybeSingle());
  if (!row) throw new HttpError(404, "공지를 찾을 수 없습니다");
  if (row.created_by !== ctx.me.id && (await rankIn(ctx, row.team_id)) < RANK.INSTRUCTOR) {
    throw new HttpError(403, "권한이 없습니다");
  }
  return row;
}

// ---------------------------------------------------------------------
// 모임·출결 도우미
// 흐름: 모임 생성(조장 이상, 대상자에게 봇 알림) → 사전 출결체크(본인, 시작 전까지)
//      → 현장 출결확인(조장 이상이 이름을 눌러 확인, 시작 후면 지각)
//      → 마감(끝나는 시간이 지나면 자동, 또는 마감 버튼) → 확인 안 된 대상자는 불참
//      → 지각·불참은 본인이 사유 입력 → 월간 리포트
// ---------------------------------------------------------------------
const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "https://kjlee7.github.io/broadcast-attend/beta/";
const HOUR = 3600000;
const SESSION_COLS = "*, meeting_types(name)";

// 한국 시간 'YYYY-MM-DD' + 'HH:MM(:SS)' → 밀리초
function kstMs(d: string, t = "00:00:00") {
  const tt = String(t).length === 5 ? t + ":00" : String(t);
  return Date.parse(`${d}T${tt}+09:00`);
}
function kstToday() { return new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10); }
// 모임 시작·끝 (끝 시간이 없으면 시작 + 3시간, 시작도 없으면 그날 밤 12시)
function sessionStart(s: any): number | null { return s.start_time ? kstMs(s.session_date, s.start_time) : null; }
function sessionEnd(s: any): number {
  if (s.end_time) return kstMs(s.session_date, s.end_time);
  const st = sessionStart(s);
  return st !== null ? st + 3 * HOUR : kstMs(s.session_date, "23:59:59");
}
// 사전 체크를 받을 수 있는 마지막 시각 (시작 시간, 없으면 그날 끝)
function planDeadline(s: any) { return sessionStart(s) ?? sessionEnd(s); }
async function lateGraceMs(ctx: Ctx) {
  const r = must(await ctx.db.from("app_settings").select("value").eq("key", "late_grace_minutes").maybeSingle());
  return Math.max(0, Number(r?.value ?? 0)) * 60000;
}
function sessionName(s: any) { return s.title || s.meeting_types?.name || "모임"; }
function sessionWhen(s: any) {
  const d = new Date(s.session_date + "T00:00:00Z");
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  const t = s.start_time ? " " + String(s.start_time).slice(0, 5) + (s.end_time ? "~" + String(s.end_time).slice(0, 5) : "") : "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd})${t}`;
}
async function getSession(ctx: Ctx, id: string) {
  const s = must(await ctx.db.from("meeting_sessions").select(SESSION_COLS).eq("id", id).maybeSingle());
  if (!s) throw new HttpError(404, "모임을 찾을 수 없습니다");
  return s;
}

// 그 모임의 대상자: 모임 날짜에 그 팀 직책이 있던 활성 인원 (대상이 조면 그 조만)
async function sessionMembers(ctx: Ctx, s: any, withTelegram = false) {
  const day = s.session_date;
  const pos: any[] = must(await ctx.db.from("position_history")
    .select(`person_id, people(name, is_active${withTelegram ? ", telegram_user_id" : ""}), positions(name, rank)`)
    .eq("org_unit_id", s.team_id).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
  const byPerson = new Map<string, any>();
  for (const r of pos) {
    if (!r.people?.is_active) continue;
    const cur = byPerson.get(r.person_id);
    if (!cur || (r.positions?.rank ?? 0) > cur.rank) {
      byPerson.set(r.person_id, {
        id: r.person_id, name: r.people.name, position: r.positions?.name ?? "", rank: r.positions?.rank ?? 0,
        group: null, group_id: null, telegram_user_id: r.people.telegram_user_id ?? null,
      });
    }
  }
  const ids = [...byPerson.keys()];
  if (ids.length) {
    const gs: any[] = must(await ctx.db.from("group_assignments")
      .select("person_id, group_unit_id, org_units(name, parent_id)").in("person_id", ids)
      .lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
    for (const g of gs) {
      if (g.org_units?.parent_id !== s.team_id) continue;
      const p = byPerson.get(g.person_id);
      p.group = g.org_units.name; p.group_id = g.group_unit_id;
    }
  }
  let list = [...byPerson.values()];
  if (s.target_unit_id) list = list.filter((m) => m.group_id === s.target_unit_id);
  return list.sort((a, b) => (a.group ?? "힣").localeCompare(b.group ?? "힣") || b.rank - a.rank || a.name.localeCompare(b.name));
}

// 공지 받을 사람: 그 단위(팀 또는 과)와 아래 단위의 직책 + 위로 문화부까지 상속된 직책. 사람마다 가장 높은 직책 하나
async function unitAudience(ctx: Ctx, unitId: string) {
  const units: any[] = must(await ctx.db.from("org_units").select("id,name,parent_id,is_permission_root,ended_on"));
  const byId = new Map(units.map((u) => [u.id, u]));
  const rel = new Set<string>();
  const down = (id: string) => { rel.add(id); for (const u of units) if (u.parent_id === id && !u.ended_on) down(u.id); };
  down(unitId);
  let up = byId.get(unitId);
  while (up && !up.is_permission_root && up.parent_id) { up = byId.get(up.parent_id); if (up) rel.add(up.id); }
  const day = kstToday();
  const pos: any[] = must(await ctx.db.from("position_history")
    .select("person_id, org_unit_id, people(name, is_active), positions(code, name, rank)")
    .in("org_unit_id", [...rel]).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
  const byPerson = new Map<string, any>();
  for (const r of pos) {
    if (!r.people?.is_active || !r.positions) continue;
    const cur = byPerson.get(r.person_id);
    if (!cur || r.positions.rank > cur.rank) {
      byPerson.set(r.person_id, {
        id: r.person_id, name: r.people.name, code: r.positions.code, position: r.positions.name, rank: r.positions.rank,
        unit: byId.get(r.org_unit_id)?.name ?? "", group: null, group_id: null,
      });
    }
  }
  const ids = [...byPerson.keys()];
  if (ids.length) {
    const gs: any[] = must(await ctx.db.from("group_assignments")
      .select("person_id, group_unit_id, org_units(name, parent_id)").in("person_id", ids)
      .lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
    for (const g of gs) {
      if (!rel.has(g.org_units?.parent_id)) continue;
      const p = byPerson.get(g.person_id);
      p.group = g.org_units.name; p.group_id = g.group_unit_id;
    }
  }
  return [...byPerson.values()].sort((a, b) => (a.group ?? "힣").localeCompare(b.group ?? "힣") || b.rank - a.rank || a.name.localeCompare(b.name));
}

// 마감: 확인 안 된 대상자는 불참 (사전 체크 때 적은 사유가 있으면 그대로 옮김)
async function closeSession(ctx: Ctx, s: any) {
  if (s.closed_at || s.status === "취소") return s;
  const members = await sessionMembers(ctx, s);
  const rows: any[] = must(await ctx.db.from("attendance").select("*").eq("session_id", s.id)) ?? [];
  const byPerson = new Map(rows.map((r) => [r.person_id, r]));
  const ups: any[] = [];
  for (const m of members) {
    const r = byPerson.get(m.id);
    if (r?.status) continue;   // 이미 참석·지각·조퇴 등이 정해짐
    ups.push({
      session_id: s.id, person_id: m.id, status: "불참",
      reason: r?.reason ?? r?.planned_reason ?? null,
      reason_at: r?.reason_at ?? (r?.planned_reason ? r.planned_at : null),
    });
  }
  if (ups.length) must(await ctx.db.from("attendance").upsert(ups, { onConflict: "session_id,person_id" }));
  return must(await ctx.db.from("meeting_sessions")
    .update({ closed_at: new Date().toISOString(), status: "완료" })
    .eq("id", s.id).select(SESSION_COLS).single());
}
// 끝나는 시간이 지난 모임은 자동 마감 (누군가 목록을 열 때 처리)
async function autoClose(ctx: Ctx, sessions: any[]) {
  const now = Date.now();
  const out = [];
  for (const s of sessions) {
    out.push(!s.closed_at && s.status === "예정" && now > sessionEnd(s) ? await closeSession(ctx, s) : s);
  }
  return out;
}

// 봇으로 대상자에게 알림 (봇을 시작하지 않은 사람에겐 못 보냄 → 이름을 돌려줌)
function escHtml(s: string) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }
async function notifyMembers(ctx: Ctx, s: any, kind: "new" | "cancel" | "change") {
  const members = (await sessionMembers(ctx, s, true)).filter((m) => m.id !== ctx.me.id);
  const head = { new: "📅 새 모임이 잡혔어요", cancel: "❌ 모임이 취소됐어요", change: "✏️ 모임 정보가 바뀌었어요" }[kind];
  const text = `<b>${head}</b>\n\n<b>${escHtml(sessionName(s))}</b>\n${escHtml(sessionWhen(s))}${s.location ? " · " + escHtml(s.location) : ""}` +
    (kind === "cancel" ? "" : "\n\n미니앱에서 참석·지각·불참을 미리 체크해주세요.");
  const markup = kind === "cancel" ? undefined : checkButton(s);
  const { sent, failed, why } = await sendToMembers(members, text, markup);
  const result = { kind, sent, failed, why, at: new Date().toISOString() };
  await ctx.db.from("meeting_sessions").update({ notified_at: result.at, notify_result: result }).eq("id", s.id);
  return result;
}
// 왼쪽 아래 메뉴 버튼: 베타에 등록된 사람만 그 사람 채팅에서 베타로 (다른 사람은 BotFather 기본값 = 운영 앱 그대로)
const MENU_TEXT = "방송예술과";
async function setBetaMenu(chatId: number | string) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, menu_button: { type: "web_app", text: MENU_TEXT, web_app: { url: MINIAPP_URL } } }),
  }).then((x) => x.json()).catch((e) => ({ ok: false, description: String(e) }));
  if (!r?.ok) console.error("menu", chatId, r?.description);
  return !!r?.ok;
}
async function ensureBetaMenu(db: any, me: any, chatId: number | string) {
  if (me.bot_menu_url === MINIAPP_URL) return;
  if (await setBetaMenu(chatId)) await db.from("people").update({ bot_menu_url: MINIAPP_URL }).eq("id", me.id);
}
// 한 번에: 베타에 등록된 활성 인원 모두 (pg_cron 비밀값으로만 부름)
async function betaMenuAll(db: any) {
  const ppl: any[] = must(await db.from("people").select("id, name, telegram_user_id, bot_menu_url").eq("is_active", true).not("telegram_user_id", "is", null)) ?? [];
  const out: any[] = [];
  for (const p of ppl) {
    const ok = await setBetaMenu(p.telegram_user_id);
    if (ok) await db.from("people").update({ bot_menu_url: MINIAPP_URL }).eq("id", p.id);
    out.push({ name: p.name, ok });
  }
  return out;
}

function checkButton(s: any) {
  return { inline_keyboard: [[{ text: "출결 체크하기", web_app: { url: `${MINIAPP_URL}?s=${s.id}` } }]] };
}
// 여러 사람에게 봇 메시지 (텔레그램 초당 제한 때문에 20명씩). 봇을 시작하지 않은 사람은 failed에 이름
// 텔레그램이 거절한 이유를 쉬운 말로 (원문은 함수 로그에)
function tgWhy(desc: string) {
  if (/initiate conversation|chat not found/i.test(desc)) return "봇과 대화를 시작하지 않음";
  if (/blocked/i.test(desc)) return "봇을 차단함";
  if (/deactivated/i.test(desc)) return "텔레그램 계정 없음";
  if (/Unauthorized/i.test(desc)) return "봇 토큰 오류";
  return desc.slice(0, 80);
}
async function sendToMembers(members: any[], text: string, markup?: unknown) {
  const failed: string[] = [];
  const why: Record<string, string> = {};
  let sent = 0;
  for (let i = 0; i < members.length; i += 20) {
    await Promise.all(members.slice(i, i + 20).map(async (m) => {
      if (!m.telegram_user_id) { failed.push(m.name); why[m.name] = "텔레그램 번호 없음"; return; }
      try {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: m.telegram_user_id, text, parse_mode: "HTML", reply_markup: markup }),
        }).then((x) => x.json());
        if (r?.ok) sent++;
        else { failed.push(m.name); why[m.name] = tgWhy(String(r?.description ?? "알 수 없음")); console.error("tg send", m.name, r?.error_code, r?.description); }
      } catch (e: any) { failed.push(m.name); why[m.name] = "보내기 실패: " + String(e?.message ?? e).slice(0, 60); console.error("tg fetch", m.name, e); }
    }));
  }
  return { sent, failed, why };
}

// ----- 사전체크 안 한 사람에게 다시 알림 -----
// 자동: 모임 시작 72시간 전·24시간 전 (cron.reminders, 10분마다). 그 시점보다 늦게 만든 모임은 그 알림을 건너뜀(만들 때 알림이 이미 감)
// 수동: 교관 이상이 버튼으로 (sessions.remind, 10분에 한 번)
async function unplannedMembers(ctx: Ctx, s: any) {
  const members = await sessionMembers(ctx, s, true);
  const rows: any[] = must(await ctx.db.from("attendance").select("person_id, planned_status, status").eq("session_id", s.id)) ?? [];
  const done = new Set(rows.filter((r) => r.planned_status || r.status).map((r) => r.person_id));
  return members.filter((m) => !done.has(m.id));
}
function leftText(ms: number) {
  const h = Math.round(ms / HOUR);
  return h >= 36 ? `약 ${Math.round(h / 24)}일` : h >= 1 ? `약 ${h}시간` : "1시간도 안";
}
const REMIND_COOLDOWN = 10 * 60000;
async function remindUnplanned(ctx: Ctx, s: any, kind: "72h" | "24h" | "manual") {
  const targets = await unplannedMembers(ctx, s);   // 누른 사람도 미체크면 같이 받음 (버튼에 보이는 인원과 같게)
  const head = kind === "manual" ? "🔔 출결 사전체크를 부탁드려요" : "⏰ 아직 출결 사전체크를 안 하셨어요";
  const text = `<b>${head}</b>\n\n<b>${escHtml(sessionName(s))}</b>\n${escHtml(sessionWhen(s))}${s.location ? " · " + escHtml(s.location) : ""}` +
    `\n\n시작까지 ${leftText(planDeadline(s) - Date.now())} 남았어요. 미니앱에서 참석·지각·불참을 미리 체크해주세요.`;
  const { sent, failed, why } = targets.length ? await sendToMembers(targets, text, checkButton(s)) : { sent: 0, failed: [] as string[], why: {} };
  const result = { kind, sent, failed, why, total: targets.length, by: kind === "manual" ? ctx.me?.name ?? null : null, at: new Date().toISOString() };
  const patch: any = { remind_result: result };
  patch[kind === "manual" ? "reminded_manual_at" : kind === "72h" ? "reminded_72h_at" : "reminded_24h_at"] = result.at;
  must(await ctx.db.from("meeting_sessions").update(patch).eq("id", s.id));
  return result;
}
// 10분마다 pg_cron이 부름: 72시간 전·24시간 전이 된 모임에 자동 알림
async function cronReminders(db: any) {
  const ctx = { db, me: { id: null, name: "자동 알림" }, payload: {} } as unknown as Ctx;
  const today = kstToday();
  const rows: any[] = must(await db.from("meeting_sessions").select(SESSION_COLS)
    .eq("status", "예정").is("closed_at", null).not("start_time", "is", null)
    .gte("session_date", today).lte("session_date", addDaysStr(today, 4))) ?? [];
  const now = Date.now(), out: any[] = [];
  for (const s of rows) {
    const st = sessionStart(s)!;
    if (st <= now) continue;
    const created = Date.parse(s.created_at), left = st - now;
    let kind: "72h" | "24h" | null = null;
    if (left <= 24 * HOUR) { if (!s.reminded_24h_at && created < st - 24 * HOUR) kind = "24h"; }
    else if (left <= 72 * HOUR) { if (!s.reminded_72h_at && created < st - 72 * HOUR) kind = "72h"; }
    if (!kind) continue;
    try { out.push({ id: s.id, ...(await remindUnplanned(ctx, s, kind)) }); }
    catch (e) { console.error("remind", s.id, e); }
  }
  return out;
}

// 출결 행에서 다른 사람에게 보여도 되는 칸 / 사유까지 (본인·조장 이상)
function attView(r: any, withReason: boolean) {
  if (!r) return null;
  const base: any = {
    planned_status: r.planned_status, planned_at: r.planned_at,
    status: r.status, arrived_at: r.arrived_at, checked_by: r.checked_by,
  };
  if (withReason) Object.assign(base, { planned_reason: r.planned_reason, reason: r.reason, reason_at: r.reason_at });
  return base;
}

// ---------------------------------------------------------------------
// 기능(action) 목록
// ---------------------------------------------------------------------
const actions: Record<string, (ctx: Ctx) => Promise<unknown>> = {

  // 내 정보 + 내가 접근할 수 있는 팀 목록(팀 선택 탭용)
  async me(ctx) {
    const { teams, positions, unitById } = await myTeams(ctx);

    const profile = must(await ctx.db.from("people")
      .select("id,name,gender,birth_date,phone,association,pin_hash")
      .eq("id", ctx.me.id).single());
    const hasPin = !!profile.pin_hash;
    delete profile.pin_hash;

    return {
      profile,
      has_pin: hasPin,
      positions: positions.map((p) => ({
        unit: unitById.get(p.org_unit_id)?.name,
        position: p.positions?.name,
        rank: p.positions?.rank,
      })),
      teams,
    };
  },

  // ===== 프로필 (본인만) =====
  // 내 정보 + 고를 수 있는 목록(지파·교회): {}
  async "profile.get"(ctx) {
    const { positions, unitById } = await myTeams(ctx);
    const person = must(await ctx.db.from("people")
      .select("id,name,gender,birth_date,phone,tribe_id,church_id,association").eq("id", ctx.me.id).single());
    const priv = must(await ctx.db.from("people_private")
      .select("district_leader_name,district_leader_phone").eq("person_id", ctx.me.id).maybeSingle());
    const tribes: any[] = must(await ctx.db.from("org_units").select("id,name,unit_type")
      .in("unit_type", ["총회", "지파"]).is("ended_on", null)) ?? [];
    const order = ["총회", "요한", "베드로", "바돌로매", "마태", "서울야고보", "부산야고보", "안드레", "빌립", "시몬", "맛디아", "다대오", "도마"];
    const rankOf = (n: string) => { const i = order.findIndex((o) => n.startsWith(o)); return i < 0 ? 99 : i; };
    tribes.sort((a, b) => rankOf(a.name) - rankOf(b.name));
    const churches: any[] = must(await ctx.db.from("churches").select("id,name,tribe_id,church_type").order("name")) ?? [];
    const external: any[] = must(await ctx.db.from("external_roles").select("role_name,affiliation")
      .eq("person_id", ctx.me.id).is("ended_on", null)) ?? [];
    return {
      person: { ...person, district_leader_name: priv?.district_leader_name ?? null, district_leader_phone: priv?.district_leader_phone ?? null },
      positions: positions.map((p) => ({ unit: unitById.get(p.org_unit_id)?.name, position: p.positions?.name, rank: p.positions?.rank })),
      external,
      tribes: tribes.map((t) => ({ id: t.id, name: t.name })),
      churches,
    };
  },

  // 내 정보 고치기: { gender, birth_date, phone, tribe_id, church_id, association, district_leader_name, district_leader_phone }
  // 이름·텔레그램 번호·직책은 여기서 못 바꿈 (팀장 이상이 관리)
  async "profile.update"(ctx) {
    const p = ctx.payload ?? {};
    const txt = (v: any, max: number) => {
      if (v === undefined) return undefined;
      const t = String(v ?? "").trim();
      if (t.length > max) throw new HttpError(400, `${max}자까지 적을 수 있어요`);
      return t || null;
    };
    const up: Record<string, unknown> = {};
    if (p.gender !== undefined) {
      if (p.gender && !["남", "여"].includes(p.gender)) throw new HttpError(400, "성별을 다시 골라주세요");
      up.gender = p.gender || null;
    }
    if (p.birth_date !== undefined) {
      if (p.birth_date && !/^\d{4}-\d\d-\d\d$/.test(p.birth_date)) throw new HttpError(400, "생년월일을 다시 확인해주세요");
      up.birth_date = p.birth_date || null;
    }
    if (p.phone !== undefined) {
      const ph = txt(p.phone, 20);
      if (ph && !/^[0-9+\- ]{7,20}$/.test(ph)) throw new HttpError(400, "연락처는 숫자와 - 만 적어주세요");
      up.phone = ph;
    }
    if (p.association !== undefined) {
      if (p.association && !["청년회", "부녀회", "장년회", "자문회"].includes(p.association)) throw new HttpError(400, "회 소속을 다시 골라주세요");
      up.association = p.association || null;
    }
    if (p.tribe_id !== undefined) {
      if (p.tribe_id) {
        const t = must(await ctx.db.from("org_units").select("id,unit_type").eq("id", p.tribe_id).maybeSingle());
        if (!t || !["총회", "지파"].includes(t.unit_type)) throw new HttpError(400, "지파를 다시 골라주세요");
      }
      up.tribe_id = p.tribe_id || null;
    }
    if (p.church_id !== undefined) {
      if (p.church_id) {
        const c = must(await ctx.db.from("churches").select("id,tribe_id").eq("id", p.church_id).maybeSingle());
        const tribe = up.tribe_id !== undefined ? up.tribe_id
          : must(await ctx.db.from("people").select("tribe_id").eq("id", ctx.me.id).single()).tribe_id;
        if (!c || (tribe && c.tribe_id !== tribe)) throw new HttpError(400, "교회를 다시 골라주세요");
      }
      up.church_id = p.church_id || null;
    }
    if (Object.keys(up).length) {
      up.updated_at = new Date().toISOString();
      must(await ctx.db.from("people").update(up).eq("id", ctx.me.id));
    }
    // 구역장 정보는 따로 보관 (본인과 팀장 이상만 봄)
    const dn = txt(p.district_leader_name, 20), dp = txt(p.district_leader_phone, 20);
    if (dp && !/^[0-9+\- ]{7,20}$/.test(dp)) throw new HttpError(400, "구역장 연락처는 숫자와 - 만 적어주세요");
    if (dn !== undefined || dp !== undefined) {
      const row: Record<string, unknown> = { person_id: ctx.me.id, updated_at: new Date().toISOString() };
      if (dn !== undefined) row.district_leader_name = dn;
      if (dp !== undefined) row.district_leader_phone = dp;
      must(await ctx.db.from("people_private").upsert(row, { onConflict: "person_id" }));
    }
    return await actions["profile.get"](ctx);
  },

  // 내 한 달 활동: { month: "YYYY-MM" }
  // 모임(정규수업·스터디·회의…) 출결 / 실무 녹음 / 그 밖의 실무(사회·촬영…) / 과제 제출
  async "profile.report"(ctx) {
    const { month } = ctx.payload;
    if (typeof month !== "string" || !/^\d{4}-\d\d$/.test(month)) throw new HttpError(400, "달을 YYYY-MM으로 넣어주세요");
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const fromTs = `${from}T00:00:00+09:00`, nextTs = `${next}T00:00:00+09:00`;

    // 1) 모임: 내가 속한 팀의 그달 모임 → 끝난 건 자동 마감 → 내 출결 줄
    const { teams } = await myTeams(ctx);
    let sessions: any[] = teams.length ? must(await ctx.db.from("meeting_sessions").select(SESSION_COLS)
      .in("team_id", teams.map((t) => t.id)).gte("session_date", from).lt("session_date", next).neq("status", "취소")
      .order("session_date").order("start_time")) ?? [] : [];
    sessions = await autoClose(ctx, sessions);
    const sById = new Map(sessions.map((x) => [x.id, x]));
    const att: any[] = sessions.length ? must(await ctx.db.from("attendance")
      .select("session_id,status,planned_status,reason,arrived_at")
      .eq("person_id", ctx.me.id).in("session_id", sessions.map((x) => x.id))) ?? [] : [];
    const byType = new Map<string, any>();
    const meetList: any[] = [];
    for (const r of att) {
      const x = sById.get(r.session_id); if (!x) continue;
      const type = x.meeting_types?.name ?? "기타 모임";
      const t = byType.get(type) ?? { type, total: 0, 참석: 0, 지각: 0, 조퇴: 0, 불참: 0, upcoming: 0 };
      if (x.closed_at && r.status) { t.total++; if (r.status in t) t[r.status]++; }
      else t.upcoming++;
      byType.set(type, t);
      const start = sessionStart(x);
      meetList.push({
        date: x.session_date, time: x.start_time ? String(x.start_time).slice(0, 5) : null, title: sessionName(x), type,
        status: x.closed_at ? r.status : null, planned_status: r.planned_status, reason: r.reason,
        late_min: r.status === "지각" && r.arrived_at && start !== null ? Math.max(0, Math.ceil((Date.parse(r.arrived_at) - start) / 60000)) : null,
      });
    }
    const types = [...byType.values()].sort((a, b) => b.total + b.upcoming - (a.total + a.upcoming));
    const sum = (k: string) => types.reduce((n, t) => n + t[k], 0);
    const closedTotal = sum("total"), came = sum("참석") + sum("지각") + sum("조퇴");
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

    // 한 부분이 실패해도 나머지는 보여주도록 (실패한 부분은 errors에 이름을 남김, 자세한 건 함수 로그)
    const errors: string[] = [];
    const safe = async <T,>(name: string, fn: () => Promise<T>, empty: T): Promise<T> => {
      try { return await fn(); } catch (e) { console.error("profile.report", name, e); errors.push(name); return empty; }
    };

    // 2) 실무 녹음: 내가 녹음자·엔지니어·감독자로 들어간 녹음 (제목·코드만, 대본은 NAS)
    const parts: any[] = await safe("녹음", async () => must(await ctx.db.from("recording_participants")
      .select("role, castings(role_name), recording_sessions!inner(id, scheduled_start, scheduled_end, location, status, retake_of, recording_requests(title, request_code, request_dept))")
      .eq("person_id", ctx.me.id)
      .gte("recording_sessions.scheduled_start", fromTs).lt("recording_sessions.scheduled_start", nextTs)) ?? [], [] as any[]);
    const recs = parts.map((r) => ({
      start: r.recording_sessions.scheduled_start, end: r.recording_sessions.scheduled_end,
      location: r.recording_sessions.location, status: r.recording_sessions.status, retake: !!r.recording_sessions.retake_of,
      title: r.recording_sessions.recording_requests?.title ?? null, code: r.recording_sessions.recording_requests?.request_code ?? null,
      dept: r.recording_sessions.recording_requests?.request_dept ?? null,
      role: r.role, cast: r.castings?.role_name ?? null,
    })).sort((a, b) => (a.start < b.start ? -1 : 1));
    const recAll = await safe("녹음 누적", async () => {
      const r = await ctx.db.from("recording_participants")
        .select("id, recording_sessions!inner(status)", { count: "exact", head: true })
        .eq("person_id", ctx.me.id).eq("recording_sessions.status", "완료");
      if (r.error) throw r.error;
      return r.count ?? 0;
    }, 0);

    // 3) 그 밖의 실무: 내가 맡은 업무(사회·촬영·음향편집·기타). 녹음 세션과 이어진 녹음 업무는 2)와 겹치니 뺌
    const duties: any[] = await safe("실무", async () => must(await ctx.db.from("duties").select("duty_type,title,place,request_dept,starts_at,ends_at,recording_session_id")
      .eq("owner_id", ctx.me.id).gte("starts_at", fromTs).lt("starts_at", nextTs).order("starts_at")) ?? [], [] as any[]);
    const dutyList = duties.filter((d) => !(d.duty_type === "녹음" && d.recording_session_id))
      .map((d) => ({ type: d.duty_type, title: d.title, place: d.place, dept: d.request_dept, start: d.starts_at, end: d.ends_at }));
    const dutyCount: Record<string, number> = {};
    for (const d of dutyList) dutyCount[d.type] = (dutyCount[d.type] ?? 0) + 1;

    // 4) 과제: 그달에 낸 과제
    const subs: any[] = await safe("과제", async () => must(await ctx.db.from("assignment_submissions")
      .select("submitted_at, feedback, assignments(title, category)")
      .eq("person_id", ctx.me.id).gte("submitted_at", fromTs).lt("submitted_at", nextTs).order("submitted_at")) ?? [], [] as any[]);

    return {
      month,
      meetings: {
        closed: closedTotal, came, 참석: sum("참석"), 지각: sum("지각"), 조퇴: sum("조퇴"), 불참: sum("불참"), upcoming: sum("upcoming"),
        rate: pct(came, closedTotal), on_time: pct(sum("참석"), closedTotal),
        by_type: types, list: meetList.sort((a, b) => (a.date + (a.time ?? "") < b.date + (b.time ?? "") ? -1 : 1)),
      },
      recordings: { list: recs, done: recs.filter((r) => r.status === "완료").length, all_time: recAll },
      duties: { list: dutyList, by_type: dutyCount },
      assignments: {
        list: subs.map((x) => ({ at: x.submitted_at, title: x.assignments?.title ?? "", category: x.assignments?.category ?? null, feedback: !!x.feedback })),
      },
      errors,
    };
  },

  // 팀 모임 유형 목록: { team_id }
  async "meeting_types.list"(ctx) {
    const { team_id } = ctx.payload;
    await requireRank(ctx, team_id, RANK.MEMBER);
    return must(await ctx.db.from("meeting_types")
      .select("id,name,target_desc,default_start,default_end,default_location,place_mode")
      .eq("team_id", team_id).eq("is_active", true)
      .order("name"));
  },

  // 팀원 목록(출결 현황에서 미제출자 확인용): { team_id } → 조장 이상
  async "team.members"(ctx) {
    const { team_id } = ctx.payload;
    await requireRank(ctx, team_id, RANK.GROUP_LEADER);
    const today = new Date().toISOString().slice(0, 10);
    const rows: any[] = must(await ctx.db.from("position_history")
      .select("person_id, people(name, is_active), positions(name, rank)")
      .eq("org_unit_id", team_id)
      .lte("started_on", today)
      .or(`ended_on.is.null,ended_on.gte.${today}`));
    const groups: any[] = must(await ctx.db.from("group_assignments")
      .select("person_id, org_units(name, parent_id)")
      .lte("started_on", today)
      .or(`ended_on.is.null,ended_on.gte.${today}`));
    const groupOf = new Map<string, string>();
    for (const g of groups) if (g.org_units?.parent_id === team_id) groupOf.set(g.person_id, g.org_units.name);

    const byPerson = new Map<string, any>();
    for (const r of rows) {
      if (!r.people?.is_active) continue;
      const cur = byPerson.get(r.person_id);
      if (!cur || (r.positions?.rank ?? 0) > cur.rank) {
        byPerson.set(r.person_id, {
          id: r.person_id, name: r.people.name,
          position: r.positions?.name, rank: r.positions?.rank ?? 0,
          group: groupOf.get(r.person_id) ?? null,
        });
      }
    }
    return [...byPerson.values()].sort((a, b) =>
      (a.group ?? "힣").localeCompare(b.group ?? "힣") || b.rank - a.rank || a.name.localeCompare(b.name));
  },

  // ----- 모임·출결 -----
  // 모임 만들기: { team_id, meeting_type_id?, title?, session_date, start_time?, end_time?, location?, place_mode?, target_unit_id?, notify? }
  // → 조장 이상. 만들면 대상자에게 봇 알림 (notify: false면 생략)
  async "sessions.create"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.GROUP_LEADER);
    if (typeof p.session_date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(p.session_date)) throw new HttpError(400, "날짜를 입력해주세요");
    if (!p.meeting_type_id && !String(p.title ?? "").trim()) throw new HttpError(400, "모임 유형을 고르거나 제목을 적어주세요");
    if (p.start_time && p.end_time && String(p.end_time) <= String(p.start_time)) throw new HttpError(400, "끝나는 시간이 시작보다 늦어야 해요");
    if (p.meeting_type_id) {
      const t = must(await ctx.db.from("meeting_types").select("team_id").eq("id", p.meeting_type_id).maybeSingle());
      if (!t || t.team_id !== p.team_id) throw new HttpError(400, "이 팀의 모임 유형이 아닙니다");
    }
    if (p.target_unit_id) {
      const g = must(await ctx.db.from("org_units").select("parent_id, unit_type").eq("id", p.target_unit_id).maybeSingle());
      if (!g || g.parent_id !== p.team_id || g.unit_type !== "조") throw new HttpError(400, "이 팀의 조가 아닙니다");
    }
    const s = must(await ctx.db.from("meeting_sessions").insert({
      ...pick(p, ["meeting_type_id", "session_date", "start_time", "end_time", "place_mode"]),
      title: String(p.title ?? "").trim().slice(0, 60) || null,
      location: String(p.location ?? "").trim().slice(0, 40) || null,
      target_unit_id: p.target_unit_id || null,
      team_id: p.team_id,
      created_by: ctx.me.id,
    }).select(SESSION_COLS).single());
    const notify = p.notify === false ? null : await notifyMembers(ctx, s, "new");
    return { ...s, notify };
  },

  // 모임 고치기·취소: { id, ...고칠 칸, notify? } → 조장 이상
  // 취소하면 대상자에게 알림. 날짜·시간·장소를 바꿨을 땐 notify: true일 때만 알림
  async "sessions.update"(ctx) {
    const before = await getSession(ctx, ctx.payload.id);
    await requireRank(ctx, before.team_id, RANK.GROUP_LEADER);
    const patch = pick(ctx.payload, ["title", "session_date", "start_time", "end_time", "location", "place_mode", "status"]);
    if ("status" in patch && !["예정", "취소"].includes(patch.status)) throw new HttpError(400, "상태가 올바르지 않습니다");
    if (before.closed_at && Object.keys(patch).some((k) => ["session_date", "start_time", "status"].includes(k))) {
      throw new HttpError(400, "이미 출결이 마감된 모임이라 날짜·시간·상태는 바꿀 수 없어요");
    }
    const t5 = (v: any) => String(v ?? "").slice(0, 5);
    if (["session_date", "start_time"].some((k) => k in patch && t5(patch[k]) !== t5(before[k]))) {
      patch.reminded_72h_at = null; patch.reminded_24h_at = null;   // 시간이 바뀌면 자동 알림을 새 시간 기준으로 다시
    }
    const s = must(await ctx.db.from("meeting_sessions").update(patch).eq("id", before.id).select(SESSION_COLS).single());
    let notify = null;
    if (ctx.payload.notify !== false && patch.status === "취소" && before.status !== "취소") {
      notify = await notifyMembers(ctx, s, "cancel");
    } else if (ctx.payload.notify === true) {
      const moved = ["session_date", "start_time", "end_time", "location"].some((k) => k in patch && t5(patch[k]) !== t5(before[k]));
      if (moved) notify = await notifyMembers(ctx, s, "change");
    }
    return { ...s, notify };
  },

  // 사전체크 안 한 사람에게 알림 보내기: { id } → 교관 이상, 모임 시작 전, 10분에 한 번
  async "sessions.remind"(ctx) {
    const s = await getSession(ctx, ctx.payload.id);
    await requireRank(ctx, s.team_id, RANK.INSTRUCTOR);
    if (s.status !== "예정" || s.closed_at) throw new HttpError(400, "끝났거나 취소된 모임이에요");
    if (Date.now() > planDeadline(s)) throw new HttpError(400, "모임이 시작돼서 사전체크는 끝났어요");
    const wait = (s.reminded_manual_at ? Date.parse(s.reminded_manual_at) : 0) + REMIND_COOLDOWN - Date.now();
    if (wait > 0) throw new HttpError(429, `방금 보냈어요. ${Math.ceil(wait / 60000)}분 뒤에 다시 보낼 수 있어요`);
    const result = await remindUnplanned(ctx, s, "manual");
    return { ...result, reminded_manual_at: result.at };
  },

  // 잘못 만든 모임 지우기: { id } → 조장 이상, 마감 전만
  async "sessions.delete"(ctx) {
    const s = await getSession(ctx, ctx.payload.id);
    await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
    if (s.closed_at) throw new HttpError(400, "마감된 모임은 지울 수 없어요. 기록이 리포트에 들어가 있어요");
    must(await ctx.db.from("meeting_sessions").delete().eq("id", s.id));
    return { ok: true };
  },

  // 모임 목록 + 모임마다 사전 체크·최종 출결 수와 내 출결: { team_id, from?, to? }
  // 끝난 모임은 이때 자동 마감됨
  async "sessions.list"(ctx) {
    const { team_id, from, to } = ctx.payload;
    const rank = await rankIn(ctx, team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    let q = ctx.db.from("meeting_sessions").select(SESSION_COLS).eq("team_id", team_id)
      .order("session_date", { ascending: true }).order("start_time", { ascending: true });
    if (from) q = q.gte("session_date", from);
    if (to) q = q.lte("session_date", to);
    const groups = await myGroupIds(ctx);
    let list: any[] = (must(await q) ?? []).filter((s: any) => visibleToMe(s, rank, groups));
    list = await autoClose(ctx, list);
    const ids = list.map((s) => s.id);
    const rows: any[] = ids.length ? must(await ctx.db.from("attendance")
      .select("session_id, person_id, planned_status, planned_reason, planned_at, status, reason, reason_at, arrived_at, checked_by")
      .in("session_id", ids)) ?? [] : [];
    // 마감 전 모임의 대상 인원은 지금 팀원 기준으로 셈
    const now = await sessionMembers(ctx, { team_id, session_date: kstToday(), target_unit_id: null });
    return list.map((s) => {
      const rs = rows.filter((r) => r.session_id === s.id);
      const targets = s.closed_at ? null : now.filter((m) => !s.target_unit_id || m.group_id === s.target_unit_id);
      const count = (k: string, v: string) => rs.filter((r) => r[k] === v).length;
      const mine = rs.find((r) => r.person_id === ctx.me.id);
      return {
        ...s,
        start_ms: sessionStart(s), end_ms: sessionEnd(s),
        target_count: targets ? targets.length : rs.length,
        is_target: targets ? targets.some((m) => m.id === ctx.me.id) : !!mine,
        planned: { 참석: count("planned_status", "참석"), 지각: count("planned_status", "지각"), 불참: count("planned_status", "불참") },
        final: { 참석: count("status", "참석"), 지각: count("status", "지각"), 불참: count("status", "불참"), 조퇴: count("status", "조퇴") },
        mine: attView(mine, true),
      };
    });
  },

  // 모임 하나의 출결 현황 (팀원 모두 볼 수 있음. 사유는 본인·조장 이상만): { session_id }
  async "sessions.board"(ctx) {
    let s = await getSession(ctx, ctx.payload.session_id);
    const rank = await rankIn(ctx, s.team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    if (!visibleToMe(s, rank, await myGroupIds(ctx))) throw new HttpError(403, "이 모임 대상이 아니에요");
    [s] = await autoClose(ctx, [s]);
    const lead = rank >= RANK.GROUP_LEADER;
    const [members, rowsRes, grace] = await Promise.all([
      sessionMembers(ctx, s),
      ctx.db.from("attendance").select("*").eq("session_id", s.id),
      lateGraceMs(ctx),
    ]);
    const rows: any[] = must(rowsRes as any) ?? [];
    const byPerson = new Map(rows.map((r) => [r.person_id, r]));
    // 마감 뒤엔 출결 기록이 있는 사람도 대상자로 보여줌 (그새 팀에서 빠진 사람)
    const known = new Set(members.map((m) => m.id));
    const extraIds = rows.map((r) => r.person_id).filter((id) => !known.has(id));
    const names = await nameMap(ctx, [...extraIds, ...rows.map((r) => r.checked_by)]);
    const list = [
      ...members,
      ...extraIds.map((id) => ({ id, name: names.get(id) ?? "", position: "", group: null })),
    ].map((m: any) => {
      const r = byPerson.get(m.id);
      const v = attView(r, lead || m.id === ctx.me.id);
      if (v && r?.checked_by) v.checked_by_name = names.get(r.checked_by) ?? "";
      return { id: m.id, name: m.name, position: m.position, group: m.group, me: m.id === ctx.me.id, att: v };
    });
    return {
      session: { ...s, start_ms: sessionStart(s), end_ms: sessionEnd(s), plan_deadline: planDeadline(s) },
      members: list,
      is_target: list.some((m) => m.me),
      can_check: lead,
      grace_min: Math.round(grace / 60000),
      server_now: Date.now(),
    };
  },

  // 사전 출결체크 (본인, 모임 시작 전까지): { session_id, planned_status: 참석|지각|불참, planned_reason? }
  async "attendance.plan"(ctx) {
    const s = await getSession(ctx, ctx.payload.session_id);
    await requireRank(ctx, s.team_id, RANK.MEMBER);
    if (s.status === "취소") throw new HttpError(400, "취소된 모임이에요");
    if (s.closed_at || Date.now() > planDeadline(s)) throw new HttpError(400, "모임이 시작돼서 사전 체크는 끝났어요");
    if (!(await sessionMembers(ctx, s)).some((m) => m.id === ctx.me.id)) throw new HttpError(403, "이 모임 대상이 아니에요");
    const st = ctx.payload.planned_status;
    if (!["참석", "지각", "불참"].includes(st)) throw new HttpError(400, "참석·지각·불참 중에 골라주세요");
    const reason = String(ctx.payload.planned_reason ?? "").trim().slice(0, 300) || null;
    if (st !== "참석" && !reason) throw new HttpError(400, `${st} 사유를 적어주세요`);
    const row = must(await ctx.db.from("attendance").upsert({
      session_id: s.id, person_id: ctx.me.id,
      planned_status: st, planned_reason: st === "참석" ? null : reason, planned_at: new Date().toISOString(),
    }, { onConflict: "session_id,person_id" }).select().single());
    return attView(row, true);
  },

  // 현장 출결확인 (조장 이상): { session_id, person_id, at?: "HH:MM"(깜빡하고 늦게 누를 때 실제 도착 시각) }
  // 시작 시간(+여유 시간) 전이면 참석, 지나면 지각
  async "attendance.check"(ctx) {
    const { session_id, person_id, at } = ctx.payload;
    const s = await getSession(ctx, session_id);
    await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
    if (s.status === "취소") throw new HttpError(400, "취소된 모임이에요");
    if (s.session_date > kstToday()) throw new HttpError(400, "모임 당일부터 확인할 수 있어요");
    const existing = must(await ctx.db.from("attendance").select("*").eq("session_id", s.id).eq("person_id", person_id).maybeSingle());
    if (!existing && !(await sessionMembers(ctx, s)).some((m) => m.id === person_id)) throw new HttpError(400, "이 모임 대상이 아니에요");
    let when = Date.now();
    if (at) {
      if (!/^\d\d:\d\d$/.test(at)) throw new HttpError(400, "시각을 HH:MM으로 넣어주세요");
      when = kstMs(s.session_date, at);
      if (when > Date.now() + 60000) throw new HttpError(400, "지금보다 뒤의 시각은 넣을 수 없어요");
    }
    const start = sessionStart(s);
    const late = start !== null && when > start + (await lateGraceMs(ctx));
    const patch: any = {
      session_id: s.id, person_id, arrived_at: new Date(when).toISOString(), checked_by: ctx.me.id,
      status: late ? "지각" : "참석",
    };
    if (!late) { patch.reason = null; patch.reason_at = null; }
    else if (!existing?.reason && existing?.planned_reason) { patch.reason = existing.planned_reason; patch.reason_at = existing.planned_at; }
    const row = must(await ctx.db.from("attendance").upsert(patch, { onConflict: "session_id,person_id" }).select().single());
    return { ...attView(row, true), checked_by_name: ctx.me.name, late_min: late && start !== null ? Math.ceil((when - start) / 60000) : 0 };
  },

  // 출결확인 취소 (잘못 눌렀을 때): { session_id, person_id } → 조장 이상
  async "attendance.uncheck"(ctx) {
    const s = await getSession(ctx, ctx.payload.session_id);
    await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
    const r = must(await ctx.db.from("attendance").select("*").eq("session_id", s.id).eq("person_id", ctx.payload.person_id).maybeSingle());
    if (!r) throw new HttpError(404, "출결 기록이 없어요");
    const closed = !!s.closed_at;
    const row = must(await ctx.db.from("attendance").update({
      arrived_at: null, checked_by: null,
      status: closed ? "불참" : null,
      reason: closed ? (r.planned_reason ?? null) : null,
      reason_at: closed && r.planned_reason ? r.planned_at : null,
    }).eq("id", r.id).select().single());
    return attView(row, true);
  },

  // 최종 출결 직접 바꾸기 (조퇴·사정 인정 등): { session_id, person_id, status } → 조장 이상
  async "attendance.setStatus"(ctx) {
    const { session_id, person_id, status } = ctx.payload;
    const s = await getSession(ctx, session_id);
    await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
    if (!["참석", "지각", "불참", "조퇴"].includes(status)) throw new HttpError(400, "상태가 올바르지 않습니다");
    const existing = must(await ctx.db.from("attendance").select("id").eq("session_id", s.id).eq("person_id", person_id).maybeSingle());
    if (!existing && !(await sessionMembers(ctx, s)).some((m) => m.id === person_id)) throw new HttpError(400, "이 모임 대상이 아니에요");
    const patch: any = { session_id: s.id, person_id, status };
    if (status === "참석") { patch.reason = null; patch.reason_at = null; }
    const row = must(await ctx.db.from("attendance").upsert(patch, { onConflict: "session_id,person_id" }).select().single());
    return attView(row, true);
  },

  // 지각·불참·조퇴 사유: { session_id, reason, person_id?(조장 이상이 대신 적을 때) }
  async "attendance.reason"(ctx) {
    const s = await getSession(ctx, ctx.payload.session_id);
    const target = ctx.payload.person_id || ctx.me.id;
    await requireRank(ctx, s.team_id, target === ctx.me.id ? RANK.MEMBER : RANK.GROUP_LEADER);
    const r = must(await ctx.db.from("attendance").select("id, status").eq("session_id", s.id).eq("person_id", target).maybeSingle());
    if (!r || !["지각", "불참", "조퇴"].includes(r.status)) throw new HttpError(400, "지각·불참으로 정해진 뒤에 사유를 적을 수 있어요");
    const reason = String(ctx.payload.reason ?? "").trim().slice(0, 300) || null;
    const row = must(await ctx.db.from("attendance").update({ reason, reason_at: reason ? new Date().toISOString() : null })
      .eq("id", r.id).select().single());
    return attView(row, true);
  },

  // 출결 마감 (끝나기 전에 미리 마감): { session_id } → 조장 이상. 확인 안 된 대상자는 불참
  async "sessions.close"(ctx) {
    const s = await getSession(ctx, ctx.payload.session_id);
    await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
    if (s.status === "취소") throw new HttpError(400, "취소된 모임이에요");
    if (Date.now() < (sessionStart(s) ?? kstMs(s.session_date))) throw new HttpError(400, "모임이 시작된 뒤에 마감할 수 있어요");
    return await closeSession(ctx, s);
  },

  // ----- 월간 출결 리포트 -----
  // { team_id, month: "YYYY-MM" } → 조장 이상은 팀 전체, 팀원은 본인 것만
  async "reports.monthly"(ctx) {
    const { team_id, month } = ctx.payload;
    if (typeof month !== "string" || !/^\d{4}-\d\d$/.test(month)) throw new HttpError(400, "달을 YYYY-MM으로 넣어주세요");
    const rank = await rankIn(ctx, team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    const lead = rank >= RANK.GROUP_LEADER;
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    let sessions: any[] = must(await ctx.db.from("meeting_sessions").select(SESSION_COLS)
      .eq("team_id", team_id).gte("session_date", from).lt("session_date", next).neq("status", "취소")
      .order("session_date", { ascending: true }).order("start_time", { ascending: true })) ?? [];
    sessions = await autoClose(ctx, sessions);
    const closed = sessions.filter((s) => s.closed_at);
    const byId = new Map(closed.map((s) => [s.id, s]));
    let rows: any[] = closed.length ? must(await ctx.db.from("attendance").select("*").in("session_id", closed.map((s) => s.id))) ?? [] : [];
    if (!lead) rows = rows.filter((r) => r.person_id === ctx.me.id);
    const names = await nameMap(ctx, rows.map((r) => r.person_id));
    const current = await sessionMembers(ctx, { team_id, session_date: kstToday(), target_unit_id: null });
    const groupOf = new Map(current.map((c) => [c.id, c.group]));

    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const people = new Map<string, any>();
    for (const r of rows) {
      const s = byId.get(r.session_id);
      const p = people.get(r.person_id) ?? {
        id: r.person_id, name: names.get(r.person_id) ?? "", group: groupOf.get(r.person_id) ?? null,
        total: 0, 참석: 0, 지각: 0, 불참: 0, 조퇴: 0, planned: 0, late_min_sum: 0, missing_reason: 0, details: [] as any[],
      };
      p.total++;
      if (r.status && r.status in p) p[r.status]++;
      if (r.planned_status) p.planned++;
      const start = sessionStart(s);
      const lateMin = r.status === "지각" && r.arrived_at && start !== null ? Math.max(0, Math.ceil((Date.parse(r.arrived_at) - start) / 60000)) : null;
      if (lateMin !== null) p.late_min_sum += lateMin;
      if (["지각", "불참", "조퇴"].includes(r.status)) {
        if (!r.reason) p.missing_reason++;
        p.details.push({
          session_id: s.id, date: s.session_date, title: sessionName(s), status: r.status,
          planned_status: r.planned_status, reason: r.reason, late_min: lateMin,
        });
      }
      people.set(r.person_id, p);
    }
    const list = [...people.values()].map((p) => ({
      ...p,
      attend_rate: pct(p.참석 + p.지각 + p.조퇴, p.total),
      on_time_rate: pct(p.참석, p.total),
      late_rate: pct(p.지각, p.total),
      absent_rate: pct(p.불참, p.total),
      planned_rate: pct(p.planned, p.total),
      avg_late_min: p.지각 ? Math.round(p.late_min_sum / p.지각) : null,
    })).sort((a, b) => (a.group ?? "힣").localeCompare(b.group ?? "힣") || a.name.localeCompare(b.name));

    const sum = (k: string) => list.reduce((n, p) => n + p[k], 0);
    const allTotal = sum("total");
    return {
      month, scope: lead ? "team" : "me",
      sessions: { total: sessions.length, closed: closed.length, open: sessions.length - closed.length },
      session_list: closed.map((s) => ({ id: s.id, date: s.session_date, title: sessionName(s), start_time: s.start_time })),
      summary: {
        people: list.length, records: allTotal,
        참석: sum("참석"), 지각: sum("지각"), 불참: sum("불참"), 조퇴: sum("조퇴"),
        attend_rate: pct(sum("참석") + sum("지각") + sum("조퇴"), allTotal),
        late_rate: pct(sum("지각"), allTotal),
        missing_reason: sum("missing_reason"),
      },
      people: list,
    };
  },

  // ----- 주간 녹음가능 -----
  // 내 주간 가능시간 불러오기: { week_start(월요일) }
  async "weekly.load"(ctx) {
    const ws = checkMonday(ctx.payload.week_start);
    const dates = weekDates(ws);
    const prevWs = addDaysStr(ws, -7);
    const [mine, sub, prev, prevSub, fixed, hours, viewable] = await Promise.all([
      ctx.db.from("availability").select("avail_date, slots").eq("person_id", ctx.me.id).in("avail_date", dates),
      ctx.db.from("weekly_submissions").select("memo, submitted_at").eq("person_id", ctx.me.id).eq("week_start", ws).maybeSingle(),
      ctx.db.from("availability").select("avail_date, slots").eq("person_id", ctx.me.id).in("avail_date", weekDates(prevWs)),
      ctx.db.from("weekly_submissions").select("memo").eq("person_id", ctx.me.id).eq("week_start", prevWs).maybeSingle(),
      ctx.db.from("fixed_schedules").select("title, weekday, start_time, end_time").eq("person_id", ctx.me.id),
      weeklyHours(ctx),
      boardTeams(ctx),
    ]);
    const toMap = (rows: any[], base: string) => {
      const m: Record<string, number[]> = {};
      for (const r of must(rows as any) ?? []) {
        const offset = Math.round((Date.parse(r.avail_date) - Date.parse(base)) / 86400000);
        if (r.slots?.length) m[String(offset)] = r.slots;
      }
      return m;
    };
    const prevSlots = toMap(prev as any, prevWs);
    return {
      week_start: ws, dates, hours,
      mine: { slots: toMap(mine as any, ws), memo: must(sub as any)?.memo ?? "", submitted: !!must(sub as any) },
      prev: { slots: prevSlots, memo: must(prevSub as any)?.memo ?? "", has: !!must(prevSub as any) || Object.keys(prevSlots).length > 0 },
      fixed: must(fixed as any) ?? [],
      can_view: viewable.length > 0,
    };
  },

  // 내 주간 가능시간 저장: { week_start, slots: { "0"(월)~"6"(일): [칸번호…] }, memo }
  async "weekly.save"(ctx) {
    const ws = checkMonday(ctx.payload.week_start);
    const dates = weekDates(ws);
    const input = ctx.payload.slots ?? {};
    let count = 0;
    const rows = dates.map((d, i) => {
      const raw = Array.isArray(input[String(i)]) ? input[String(i)] : [];
      const slots = [...new Set(raw.map((x: any) => Number(x)))]
        .filter((x: any) => Number.isInteger(x) && x >= 0 && x <= 47)
        .sort((a: any, b: any) => a - b) as number[];
      count += slots.length;
      return { person_id: ctx.me.id, avail_date: d, slots };
    });
    must(await ctx.db.from("availability").upsert(rows, { onConflict: "person_id,avail_date" }));
    const memo = String(ctx.payload.memo ?? "").trim().slice(0, 200) || null;
    must(await ctx.db.from("weekly_submissions").upsert(
      { person_id: ctx.me.id, week_start: ws, memo, submitted_at: new Date().toISOString() },
      { onConflict: "person_id,week_start" }));
    return { count };
  },

  // 주간 가능시간 모아보기: { week_start } → 내가 조장 이상인 팀 + 녹음 관계자면 녹음 관련 팀 전체
  async "weekly.board"(ctx) {
    const ws = checkMonday(ctx.payload.week_start);
    const dates = weekDates(ws);
    const teams = await boardTeams(ctx);
    if (!teams.length) throw new HttpError(403, "권한이 없습니다");
    const teamIds = teams.map((t) => t.id);
    const today = new Date().toISOString().slice(0, 10);

    const pos: any[] = must(await ctx.db.from("position_history")
      .select("person_id, org_unit_id, people(name, is_active)")
      .in("org_unit_id", teamIds)
      .lte("started_on", today)
      .or(`ended_on.is.null,ended_on.gte.${today}`));
    const people = new Map<string, any>();
    for (const p of pos) {
      if (!p.people?.is_active) continue;
      const cur = people.get(p.person_id) ?? { id: p.person_id, name: p.people.name, teams: [] as string[], group: null, answered: false, memo: "", slots: {} };
      const tname = teams.find((t) => t.id === p.org_unit_id)?.name;
      if (tname && !cur.teams.includes(tname)) cur.teams.push(tname);
      people.set(p.person_id, cur);
    }
    const ids = [...people.keys()];
    if (ids.length) {
      const [groups, avail, subs] = await Promise.all([
        ctx.db.from("group_assignments").select("person_id, org_units(name, parent_id)").in("person_id", ids)
          .lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`),
        ctx.db.from("availability").select("person_id, avail_date, slots").in("person_id", ids).in("avail_date", dates),
        ctx.db.from("weekly_submissions").select("person_id, memo").in("person_id", ids).eq("week_start", ws),
      ]);
      for (const g of must(groups as any) ?? []) {
        if (teamIds.includes(g.org_units?.parent_id)) people.get(g.person_id).group = g.org_units.name;
      }
      for (const a of must(avail as any) ?? []) {
        if (!a.slots?.length) continue;
        const offset = Math.round((Date.parse(a.avail_date) - Date.parse(ws)) / 86400000);
        people.get(a.person_id).slots[String(offset)] = a.slots;
      }
      for (const s of must(subs as any) ?? []) {
        const p = people.get(s.person_id);
        p.answered = true; p.memo = s.memo ?? "";
      }
    }
    return {
      week_start: ws, dates, hours: await weeklyHours(ctx),
      teams: teams.map((t) => t.name),
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  // ----- 고정 일정 -----
  // 내 고정 일정: 이름·시간이 같은 줄을 묶어서 [{ title, weekdays:[0=일…6=토], start, end }]
  async "fixed.list"(ctx) {
    return groupFixed(must(await ctx.db.from("fixed_schedules")
      .select("title, weekday, start_time, end_time").eq("person_id", ctx.me.id)));
  },

  // 내 고정 일정 통째로 저장: { list: [{ title, weekdays, start, end }] }
  async "fixed.save"(ctx) {
    const list = Array.isArray(ctx.payload.list) ? ctx.payload.list : [];
    if (list.length > 8) throw new HttpError(400, "고정 일정은 8개까지 넣을 수 있어요");
    const rows: any[] = [];
    for (const f of list) {
      const title = String(f.title ?? "").trim().slice(0, 20);
      const start = String(f.start ?? ""), end = String(f.end ?? "");
      const days = [...new Set((f.weekdays ?? []).map((x: any) => Number(x)))].filter((x: any) => x >= 0 && x <= 6);
      if (!title) throw new HttpError(400, "일정 이름을 적어주세요 (예: 직장)");
      if (!days.length) throw new HttpError(400, `'${title}' 요일을 골라주세요`);
      if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start) {
        throw new HttpError(400, `'${title}' 끝나는 시간이 시작보다 늦어야 해요`);
      }
      for (const d of days) rows.push({ person_id: ctx.me.id, title, weekday: d, start_time: start, end_time: end });
    }
    must(await ctx.db.from("fixed_schedules").delete().eq("person_id", ctx.me.id));
    if (rows.length) must(await ctx.db.from("fixed_schedules").insert(rows));
    return groupFixed(rows);
  },

  // ----- 공지 -----
  // 팀 공지 + 방송예술과 전체 공지: { team_id }
  async "notices.list"(ctx) {
    const { team_id } = ctx.payload;
    const rank = await rankIn(ctx, team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    const units = await teamAndSection(ctx, team_id);
    const [rows, groups, posRes] = await Promise.all([
      ctx.db.from("notices").select("id, team_id, title, body, target_unit_id, target_positions, is_pinned, published_at, created_by")
        .in("team_id", units).order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(60),
      myGroupIds(ctx),
      ctx.db.from("positions").select("code, name, rank"),
    ]);
    const pos = new Map((must(posRes as any) ?? []).map((p: any) => [p.code, p]));
    // 직책을 콕 집은 공지: 그 직책인 사람 + 쓴 사람 + 관리하는 사람(팀 공지는 교관 이상, 과 공지는 팀장 이상)
    const forMe = (r: any) => !r.target_positions?.length || r.created_by === ctx.me.id ||
      rank >= (r.team_id === team_id ? RANK.INSTRUCTOR : RANK.TEAM_LEADER) ||
      r.target_positions.some((c: string) => (pos.get(c) as any)?.rank === rank);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups) && forMe(r));
    const names = await nameMap(ctx, list.map((r: any) => r.created_by));
    return list.map((r: any) => ({
      ...r, scope: r.team_id === team_id ? "team" : "section",
      target_names: (r.target_positions ?? []).map((c: string) => (pos.get(c) as any)?.name).filter(Boolean),
      author: names.get(r.created_by) ?? null, mine: r.created_by === ctx.me.id,
    }));
  },

  // 공지 쓰기: { team_id, scope: "team"(교관 이상) | "section"(팀장 이상, 방송예술과 전체), title, body, is_pinned,
  //             target_unit_id?(조, 팀 공지만), target_positions?(직책 코드 목록, 비우면 모두) }
  async "notices.create"(ctx) {
    const p = ctx.payload;
    const unit = await noticeUnit(ctx, p);
    const section = unit !== p.team_id;
    const title = String(p.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(400, "제목을 입력해주세요");
    const codes = Array.isArray(p.target_positions) ? [...new Set(p.target_positions.map(String))] : [];
    if (codes.length) {
      const ok: any[] = must(await ctx.db.from("positions").select("code").in("code", codes)) ?? [];
      if (ok.length !== codes.length) throw new HttpError(400, "직책이 올바르지 않습니다");
    }
    return must(await ctx.db.from("notices").insert({
      team_id: unit, title, body: String(p.body ?? "").trim().slice(0, 3000) || null,
      is_pinned: !!p.is_pinned, target_unit_id: section ? null : (p.target_unit_id || null),
      target_positions: codes.length ? codes : null,
      created_by: ctx.me.id,
    }).select().single());
  },

  // 공지 받을 사람 명단(대상 고르기용): { team_id, scope } → 그 범위에 공지를 쓸 수 있는 사람만
  async "notices.audience"(ctx) {
    return await unitAudience(ctx, await noticeUnit(ctx, ctx.payload));
  },

  // 공지 고치기·지우기: { id, title?, body?, is_pinned? } / { id } → 쓴 사람 또는 교관 이상
  async "notices.update"(ctx) {
    const row = await editableNotice(ctx, ctx.payload.id);
    const patch = pick(ctx.payload, ["title", "body", "is_pinned"]);
    if ("title" in patch && !String(patch.title).trim()) throw new HttpError(400, "제목을 입력해주세요");
    return must(await ctx.db.from("notices").update(patch).eq("id", row.id).select().single());
  },
  async "notices.delete"(ctx) {
    const row = await editableNotice(ctx, ctx.payload.id);
    must(await ctx.db.from("notices").delete().eq("id", row.id));
    return { ok: true };
  },

  // 팀의 조 목록 (대상 고르기용): { team_id }
  async "team.groups"(ctx) {
    await requireRank(ctx, ctx.payload.team_id, RANK.MEMBER);
    return must(await ctx.db.from("org_units").select("id, name")
      .eq("parent_id", ctx.payload.team_id).eq("unit_type", "조").is("ended_on", null).order("name"));
  },

  // ----- 과제 -----
  // 과제 목록 + 내 제출 (조장 이상은 제출 수도): { team_id }
  async "assignments.list"(ctx) {
    const { team_id } = ctx.payload;
    const rank = await rankIn(ctx, team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    const since = addDaysStr(new Date().toISOString().slice(0, 10), -30);
    const [rows, groups] = await Promise.all([
      ctx.db.from("assignments").select("*").eq("team_id", team_id)
        .or(`due_at.is.null,due_at.gte.${since}`).order("created_at", { ascending: false }).limit(60),
      myGroupIds(ctx),
    ]);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups));
    const ids = list.map((a: any) => a.id);
    let subs: any[] = [];
    if (ids.length) {
      let q = ctx.db.from("assignment_submissions").select("id, assignment_id, person_id, content, file_url, submitted_at, feedback, feedback_at").in("assignment_id", ids);
      if (rank < RANK.GROUP_LEADER) q = q.eq("person_id", ctx.me.id);
      subs = must(await q) ?? [];
    }
    return list.map((a: any) => ({
      ...a,
      my: subs.find((s) => s.assignment_id === a.id && s.person_id === ctx.me.id) ?? null,
      submitted_count: rank >= RANK.GROUP_LEADER ? subs.filter((s) => s.assignment_id === a.id).length : null,
    }));
  },

  // 과제 내기: { team_id, category?, title, description?, starts_on?, due_at?, needs_feedback?, target_unit_id? } → 교관 이상
  async "assignments.create"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    const title = String(p.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(400, "과제 제목을 입력해주세요");
    return must(await ctx.db.from("assignments").insert({
      ...pick(p, ["category", "description", "starts_on", "due_at", "needs_feedback", "target_unit_id"]),
      title, team_id: p.team_id, created_by: ctx.me.id,
    }).select().single());
  },
  async "assignments.update"(ctx) {
    await requireRank(ctx, await ownerTeam(ctx, "assignments", ctx.payload.id), RANK.INSTRUCTOR);
    return must(await ctx.db.from("assignments")
      .update(pick(ctx.payload, ["category", "title", "description", "starts_on", "due_at", "needs_feedback", "target_unit_id"]))
      .eq("id", ctx.payload.id).select().single());
  },
  async "assignments.delete"(ctx) {
    await requireRank(ctx, await ownerTeam(ctx, "assignments", ctx.payload.id), RANK.INSTRUCTOR);
    must(await ctx.db.from("assignments").delete().eq("id", ctx.payload.id));
    return { ok: true };
  },

  // 내 과제 제출·수정: { assignment_id, content?, file_url? }
  async "submissions.saveMine"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, await ownerTeam(ctx, "assignments", p.assignment_id), RANK.MEMBER);
    const content = String(p.content ?? "").trim().slice(0, 5000) || null;
    const file_url = String(p.file_url ?? "").trim().slice(0, 500) || null;
    if (!content && !file_url) throw new HttpError(400, "내용이나 링크를 넣어주세요");
    return must(await ctx.db.from("assignment_submissions").upsert(
      { assignment_id: p.assignment_id, person_id: ctx.me.id, content, file_url, submitted_at: new Date().toISOString() },
      { onConflict: "assignment_id,person_id" }).select().single());
  },

  // 제출 현황: { assignment_id } → 조장 이상
  async "submissions.list"(ctx) {
    const id = ctx.payload.assignment_id;
    await requireRank(ctx, await ownerTeam(ctx, "assignments", id), RANK.GROUP_LEADER);
    const rows: any[] = must(await ctx.db.from("assignment_submissions").select("*").eq("assignment_id", id)) ?? [];
    const names = await nameMap(ctx, rows.flatMap((r) => [r.person_id, r.feedback_by]));
    return rows.map((r) => ({ ...r, name: names.get(r.person_id) ?? "", feedback_name: names.get(r.feedback_by) ?? null }));
  },

  // 피드백 남기기: { id(제출), feedback } → 조장 이상
  async "submissions.feedback"(ctx) {
    const sub = must(await ctx.db.from("assignment_submissions").select("assignment_id").eq("id", ctx.payload.id).maybeSingle());
    if (!sub) throw new HttpError(404, "제출을 찾을 수 없습니다");
    await requireRank(ctx, await ownerTeam(ctx, "assignments", sub.assignment_id), RANK.GROUP_LEADER);
    const feedback = String(ctx.payload.feedback ?? "").trim().slice(0, 2000) || null;
    return must(await ctx.db.from("assignment_submissions").update({
      feedback, feedback_by: feedback ? ctx.me.id : null, feedback_at: feedback ? new Date().toISOString() : null,
    }).eq("id", ctx.payload.id).select().single());
  },

  // ----- 체크인 (기상·출발·도착) -----
  // 체크인 목록 + 내 보고 (조장 이상은 전체 보고): { team_id }
  async "checkins.list"(ctx) {
    const { team_id } = ctx.payload;
    const rank = await rankIn(ctx, team_id);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
    const today = new Date().toISOString().slice(0, 10);
    const [rows, groups] = await Promise.all([
      ctx.db.from("checkins").select("*").eq("team_id", team_id)
        .gte("check_date", addDaysStr(today, -7)).lte("check_date", addDaysStr(today, 30))
        .order("check_date", { ascending: false }),
      myGroupIds(ctx),
    ]);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups));
    const ids = list.map((c: any) => c.id);
    let reps: any[] = [];
    if (ids.length) {
      let q = ctx.db.from("checkin_reports").select("checkin_id, person_id, item, reported_at, note").in("checkin_id", ids);
      if (rank < RANK.GROUP_LEADER) q = q.eq("person_id", ctx.me.id);
      reps = must(await q) ?? [];
    }
    const names = rank >= RANK.GROUP_LEADER ? await nameMap(ctx, reps.map((r) => r.person_id)) : new Map();
    return list.map((c: any) => {
      const mine: Record<string, any> = {};
      for (const r of reps) if (r.checkin_id === c.id && r.person_id === ctx.me.id) mine[r.item] = { at: r.reported_at, note: r.note };
      return {
        ...c, mine,
        reports: rank >= RANK.GROUP_LEADER
          ? reps.filter((r) => r.checkin_id === c.id).map((r) => ({ ...r, name: names.get(r.person_id) ?? "" }))
          : null,
      };
    });
  },

  // 체크인 만들기: { team_id, title, check_date, items?, target_unit_id? } → 교관 이상
  async "checkins.create"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    const title = String(p.title ?? "").trim().slice(0, 60);
    if (!title) throw new HttpError(400, "제목을 입력해주세요");
    if (!p.check_date) throw new HttpError(400, "날짜를 골라주세요");
    const items = (Array.isArray(p.items) ? p.items : []).filter((x: any) => ["기상", "출발", "도착"].includes(x));
    if (!items.length) throw new HttpError(400, "받을 항목을 하나 이상 골라주세요");
    return must(await ctx.db.from("checkins").insert({
      team_id: p.team_id, title, check_date: p.check_date, items,
      target_unit_id: p.target_unit_id || null, session_id: p.session_id || null, created_by: ctx.me.id,
    }).select().single());
  },
  async "checkins.delete"(ctx) {
    await requireRank(ctx, await ownerTeam(ctx, "checkins", ctx.payload.id), RANK.INSTRUCTOR);
    must(await ctx.db.from("checkins").delete().eq("id", ctx.payload.id));
    return { ok: true };
  },

  // 체크인 보고: { checkin_id, item, note?(도착 예정 등) } / 잘못 눌렀을 때 취소: checkins.unreport
  async "checkins.report"(ctx) {
    const c = must(await ctx.db.from("checkins").select("team_id, items").eq("id", ctx.payload.checkin_id).maybeSingle());
    if (!c) throw new HttpError(404, "체크인을 찾을 수 없습니다");
    await requireRank(ctx, c.team_id, RANK.MEMBER);
    if (!c.items.includes(ctx.payload.item)) throw new HttpError(400, "이 체크인에 없는 항목입니다");
    return must(await ctx.db.from("checkin_reports").upsert({
      checkin_id: ctx.payload.checkin_id, person_id: ctx.me.id, item: ctx.payload.item,
      reported_at: new Date().toISOString(), note: String(ctx.payload.note ?? "").trim().slice(0, 100) || null,
    }, { onConflict: "checkin_id,person_id,item" }).select().single());
  },
  async "checkins.unreport"(ctx) {
    must(await ctx.db.from("checkin_reports").delete()
      .eq("checkin_id", ctx.payload.checkin_id).eq("person_id", ctx.me.id).eq("item", ctx.payload.item));
    return { ok: true };
  },

  // ----- 홈 대시보드 (과 전체가 같은 화면) -----
  // { team_id } → 이 팀이 속한 과 기준: 2주 사명자 일정(+모임 회차), 지금/준비 중 업무, 프로젝트, 12지파 인원, 내 주간 녹음가능 제출 여부
  async "dashboard.load"(ctx) {
    const { team_id } = ctx.payload;
    await requireRank(ctx, team_id, RANK.MEMBER);
    const DAY = 86400000, DEFAULT_DURATION = 3 * 3600000;   // 끝 시간이 없으면 시작 후 3시간을 '진행 중'으로 봄
    const team = must(await ctx.db.from("org_units").select("id, parent_id").eq("id", team_id).maybeSingle());
    const sectionId = team?.parent_id ?? team_id;
    const kids: any[] = must(await ctx.db.from("org_units").select("id, name")
      .eq("parent_id", sectionId).eq("unit_type", "팀").is("ended_on", null)) ?? [];
    const teamIds = kids.map((k) => k.id);
    const unitIds = [sectionId, ...teamIds];
    const unitName = new Map<string, string>(kids.map((k) => [k.id, k.name]));

    // 한국 시간 기준 날짜
    const kst = new Date(Date.now() + 9 * 3600000);
    const todayK = kst.toISOString().slice(0, 10);
    const dow = kst.getUTCDay();
    const sunday = addDaysStr(todayK, -dow);                 // 이번 주 일요일
    const until = addDaysStr(sunday, 14);
    const kstMs = (d: string, t = "00:00:00") => Date.parse(`${d}T${t}+09:00`);
    const thisMon = addDaysStr(todayK, -((dow + 6) % 7)), nextMon = addDaysStr(thisMon, 7);
    const now = Date.now();

    const [sched, sess, duty, proj, tribes, stats, subs] = await Promise.all([
      ctx.db.from("staff_schedules").select("*").in("unit_id", unitIds)
        .gte("starts_at", new Date(kstMs(sunday)).toISOString()).lt("starts_at", new Date(kstMs(until)).toISOString()),
      teamIds.length ? ctx.db.from("meeting_sessions")
        .select("id, team_id, title, session_date, start_time, end_time, location, status, created_by, meeting_types(name)")
        .in("team_id", teamIds).gte("session_date", sunday).lt("session_date", until).neq("status", "취소")
        : Promise.resolve({ data: [], error: null }),
      ctx.db.from("duties").select("*").in("unit_id", unitIds)
        .or(`starts_at.is.null,starts_at.gte.${new Date(now - DAY).toISOString()}`).order("starts_at", { ascending: true }).limit(100),
      ctx.db.from("projects").select("*").in("unit_id", unitIds).neq("status", "완료").order("due_on", { ascending: true }),
      ctx.db.from("org_units").select("id, name").eq("unit_type", "지파"),
      ctx.db.from("tribe_stats").select("tribe_id, headcount"),
      ctx.db.from("weekly_submissions").select("week_start").eq("person_id", ctx.me.id).in("week_start", [thisMon, nextMon]),
    ]);
    const S = must(sched as any) ?? [], M = must(sess as any) ?? [], Du = must(duty as any) ?? [], P = must(proj as any) ?? [];
    const names = await nameMap(ctx, [
      ...S.map((r: any) => r.organizer_id), ...M.map((r: any) => r.created_by),
      ...Du.map((r: any) => r.owner_id), ...P.flatMap((r: any) => [r.owner_id, r.mc_id]),
    ]);
    const unitLabel = (id: string) => unitName.get(id) ?? "방송예술과";

    // 사명자 일정 = 직접 등록한 일정 + 각 팀 모임 회차
    const schedules = [
      ...S.map((r: any) => ({
        start: Date.parse(r.starts_at), end: r.ends_at ? Date.parse(r.ends_at) : null,
        title: r.title, category: r.category ?? "", place: r.place ?? "",
        name: names.get(r.organizer_id) ?? "", role: r.organizer_role ?? unitLabel(r.unit_id), participants: r.participants ?? "",
      })),
      ...M.map((r: any) => ({
        start: kstMs(r.session_date, r.start_time ?? "00:00:00"), end: r.end_time ? kstMs(r.session_date, r.end_time) : null,
        title: r.title || r.meeting_types?.name || "모임", category: r.meeting_types?.name ?? "모임", place: r.location ?? "",
        name: names.get(r.created_by) ?? "", role: unitLabel(r.team_id), participants: unitLabel(r.team_id),
      })),
    ].sort((a, b) => a.start - b.start);

    // 업무: 진행 중 / 예정
    const tasks = Du.map((r: any) => ({
      type: r.duty_type, team: unitLabel(r.unit_id), title: r.title, owner: names.get(r.owner_id) ?? "",
      place: r.place ?? "", dept: r.request_dept ?? "",
      start: r.starts_at ? Date.parse(r.starts_at) : null, end: r.ends_at ? Date.parse(r.ends_at) : null,
    }));
    const isNow = (t: any) => t.start !== null && t.start <= now && now < (t.end ?? t.start + DEFAULT_DURATION);
    const tasksNow = tasks.filter(isNow);
    const tasksUpcoming = tasks.filter((t: any) => !isNow(t) && (t.start === null || t.start > now))
      .sort((a: any, b: any) => (a.start ?? Infinity) - (b.start ?? Infinity));

    const projects = P.map((r: any) => ({
      channel: r.channel ?? "", title: r.title, desc: r.description ?? "",
      owner: names.get(r.owner_id) ?? "", mc: names.get(r.mc_id) ?? "",
      progress: r.progress, due: r.due_on ? kstMs(r.due_on) : null, status: r.status,
    }));

    const countOf = new Map<string, number | null>((must(stats as any) ?? []).map((s: any) => [s.tribe_id, s.headcount]));
    const tribeList = (must(tribes as any) ?? []).map((t: any) => ({ name: String(t.name).replace(/지파$/, ""), count: countOf.get(t.id) ?? null }));
    const filled = tribeList.some((t: any) => t.count !== null);
    const total = tribeList.reduce((n: number, t: any) => n + (t.count ?? 0), 0);

    const done = new Set((must(subs as any) ?? []).map((s: any) => s.week_start));
    return {
      schedules, tasksNow, tasksUpcoming, projects,
      teams: kids.map((k) => k.name),
      tribes: { list: tribeList, total, filled },
      weekly: {
        this: { week_start: thisMon, submitted: done.has(thisMon) },
        next: { week_start: nextMon, submitted: done.has(nextMon), due: kstMs(addDaysStr(nextMon, -1), "22:00:00") },
        isSunday: dow === 0,
      },
    };
  },

  // ----- 동네지도 (PC 홈) -----
  // { team_id } → 이 팀이 속한 과 사람들의 '오늘 일정'을 장소·업무유형으로 정리
  // 일정 우선순위: 녹음 > 업무(사회·촬영 등) > 모임 > 사명자 일정 > 고정일정(직장). 일정이 없으면 화면에서 휴게실.
  // 녹음·사회의 구체적인 내용(detail)은 보는 사람이 과 안의 어느 팀에서든 교관 이상일 때만 보냄.
  async "dashboard.scene"(ctx) {
    const { team_id } = ctx.payload;
    await requireRank(ctx, team_id, RANK.MEMBER);
    const team = must(await ctx.db.from("org_units").select("id, parent_id").eq("id", team_id).maybeSingle());
    const sectionId = team?.parent_id ?? team_id;
    const kids: any[] = must(await ctx.db.from("org_units").select("id, name")
      .eq("parent_id", sectionId).eq("unit_type", "팀").is("ended_on", null)) ?? [];
    const teamIds = kids.map((k) => k.id), unitIds = [sectionId, ...teamIds];
    const teamName = new Map<string, string>(kids.map((k) => [k.id, k.name]));

    let myMax = 0;
    for (const t of teamIds) myMax = Math.max(myMax, await rankIn(ctx, t));
    const canDetail = myMax >= RANK.INSTRUCTOR;

    const today = kstToday();
    const dow = new Date(today + "T00:00:00Z").getUTCDay();
    const dayStart = kstMs(today), dayEnd = dayStart + 24 * HOUR;
    const toMin = (ms: number) => Math.max(0, Math.min(1440, Math.round((ms - dayStart) / 60000)));
    const hm = (t: string) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

    // 과 사람들 (팀·과 직책이 오늘 유효한 활성 인원). 직책이 여럿이면 등급 높은 것
    const pos: any[] = must(await ctx.db.from("position_history")
      .select("person_id, org_unit_id, people(name, is_active), positions(name, rank)")
      .in("org_unit_id", unitIds).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
    const ppl = new Map<string, any>();
    for (const r of pos) {
      if (!r.people?.is_active) continue;
      const rank = r.positions?.rank ?? 0, cur = ppl.get(r.person_id);
      if (!cur || rank > cur.rank) {
        ppl.set(r.person_id, { id: r.person_id, name: r.people.name, rank, role: r.positions?.name ?? "",
          team: teamName.get(r.org_unit_id) ?? "방송예술과", teamId: teamName.has(r.org_unit_id) ? r.org_unit_id : null });
      }
    }
    const ids = [...ppl.keys()];
    if (ids.length) {
      const gs: any[] = must(await ctx.db.from("group_assignments").select("person_id, org_units(name, parent_id)")
        .in("person_id", ids).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
      for (const g of gs) { const p = ppl.get(g.person_id); if (p && g.org_units?.parent_id === p.teamId) p.group = g.org_units.name; }
    }

    const dayIso = [new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()];
    const none = Promise.resolve({ data: [], error: null });
    const [plc, sess, recs, duty, staff, fixed] = await Promise.all([
      ctx.db.from("places").select("code, name, aliases").eq("is_active", true),
      teamIds.length ? ctx.db.from("meeting_sessions")
        .select("id, team_id, title, session_date, start_time, end_time, location, target_unit_id, status, created_by, meeting_types(name, default_location)")
        .in("team_id", teamIds).eq("session_date", today).neq("status", "취소") : none,
      teamIds.length ? ctx.db.from("recording_sessions")
        .select("id, team_id, scheduled_start, scheduled_end, location, status, recording_requests(title, request_code), recording_participants(person_id, role)")
        .in("team_id", teamIds).gte("scheduled_start", dayIso[0]).lt("scheduled_start", dayIso[1]) : none,
      ctx.db.from("duties").select("id, duty_type, title, owner_id, place, starts_at, ends_at, recording_session_id")
        .in("unit_id", unitIds).gte("starts_at", dayIso[0]).lt("starts_at", dayIso[1]),
      ctx.db.from("staff_schedules").select("id, title, category, place, organizer_id, starts_at, ends_at")
        .in("unit_id", unitIds).gte("starts_at", dayIso[0]).lt("starts_at", dayIso[1]),
      ids.length ? ctx.db.from("fixed_schedules").select("person_id, start_time, end_time, valid_from, valid_to")
        .in("person_id", ids).eq("weekday", dow) : none,
    ]);

    // 장소 글자 → 장소 코드 (긴 별칭부터 맞춤). 목록에 없으면 '외부'
    const norm = (s: any) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
    const aliasList: [string, string][] = [];
    for (const p of must(plc as any) ?? []) for (const a of [p.name, ...(p.aliases ?? [])]) if (norm(a)) aliasList.push([norm(a), p.code]);
    aliasList.sort((a, b) => b[0].length - a[0].length);
    const where = (loc: any) => {
      const n = norm(loc);
      if (!n) return { place: "outside", ext: "장소 미정" };
      for (const [a, code] of aliasList) if (n.includes(a)) return { place: code, ext: "" };
      return { place: "outside", ext: String(loc).trim().slice(0, 20) };
    };
    const kindOf = (name: string, fallback: string) => {
      const s = String(name ?? "");
      if (/회의/.test(s)) return "회의"; if (/스터디/.test(s)) return "스터디"; if (/연습|리허설/.test(s)) return "연습";
      if (/수업|교육|강의|훈련/.test(s)) return "수업"; return fallback;
    };

    const segs: any[] = [];
    const push = (pid: string, from: number, to: number, w: any, type: string, title: string, detail: string, lead = false) => {
      if (!ppl.has(pid) || to <= from) return;
      segs.push({ pid, from, to, place: w.place, ext: w.ext, type, title, detail, lead });
    };

    // 1) 녹음: 참여자 모두. 녹음 제목·코드는 교관 이상만
    for (const r of must(recs as any) ?? []) {
      if (r.status === "취소") continue;
      const st = Date.parse(r.scheduled_start), en = r.scheduled_end ? Date.parse(r.scheduled_end) : st + 2 * HOUR;
      const req = r.recording_requests, base = req ? [req.title, req.request_code].filter(Boolean).join(" · ") : "녹음";
      for (const pt of r.recording_participants ?? []) {
        push(pt.person_id, toMin(st), toMin(en), where(r.location), "녹음", "",
          canDetail ? [base, pt.role].filter(Boolean).join(" · ") : "");
      }
    }
    // 2) 업무 (녹음과 연결된 업무는 위에서 이미 셈)
    const DUTY: Record<string, string> = { "녹음": "녹음", "사회": "사회", "촬영": "촬영", "음향편집": "편집" };
    for (const d of must(duty as any) ?? []) {
      if (d.recording_session_id || !d.owner_id) continue;
      const type = DUTY[d.duty_type] ?? "기타", gated = type === "녹음" || type === "사회";
      const st = Date.parse(d.starts_at), en = d.ends_at ? Date.parse(d.ends_at) : st + 3 * HOUR;
      push(d.owner_id, toMin(st), toMin(en), where(d.place), type, gated ? "" : (d.title ?? ""), gated && canDetail ? (d.title ?? "") : "", type === "사회");
    }
    // 3) 모임: 대상자 중 불참(사전·최종)이 아닌 사람. 만든 사람이 진행자
    const S = must(sess as any) ?? [];
    const att: any[] = S.length ? must(await ctx.db.from("attendance").select("session_id, person_id, status, planned_status")
      .in("session_id", S.map((s: any) => s.id))) ?? [] : [];
    for (const s of S) {
      if (!s.start_time) continue;
      const from = toMin(sessionStart(s)!), to = toMin(sessionEnd(s));
      const absent = new Set(att.filter((a) => a.session_id === s.id && (a.status === "불참" || (!a.status && a.planned_status === "불참"))).map((a) => a.person_id));
      const w = where(s.location || s.meeting_types?.default_location);
      const type = kindOf(s.meeting_types?.name ?? s.title, "모임");
      for (const m of await sessionMembers(ctx, s)) {
        if (absent.has(m.id)) continue;
        push(m.id, from, to, w, type, sessionName(s), "", m.id === s.created_by);
      }
    }
    // 4) 사명자 일정: 주최자만 (참여자는 글자로만 적혀 있어서 사람과 연결할 수 없음)
    for (const r of must(staff as any) ?? []) {
      if (!r.organizer_id) continue;
      const st = Date.parse(r.starts_at), en = r.ends_at ? Date.parse(r.ends_at) : st + 3 * HOUR;
      push(r.organizer_id, toMin(st), toMin(en), where(r.place), kindOf(r.category || r.title, "모임"), r.title ?? "", "", true);
    }
    // 5) 고정일정 = 직장 (제목은 보내지 않음)
    for (const f of must(fixed as any) ?? []) {
      if ((f.valid_from && f.valid_from > today) || (f.valid_to && f.valid_to < today)) continue;
      push(f.person_id, hm(f.start_time), hm(f.end_time), { place: "work", ext: "" }, "근무", "", "");
    }

    const people = [...ppl.values()].sort((a, b) => a.team.localeCompare(b.team) || b.rank - a.rank || a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name, team: p.team, role: [p.role, p.group].filter(Boolean).join(" · ") }));
    return { date: today, can_detail: canDetail, people, segs };
  },

  // 최초 PIN 설정: { pin } → PIN이 아직 없을 때만
  async "pin.setInitial"(ctx) {
    const p = must(await ctx.db.from("people").select("pin_hash").eq("id", ctx.me.id).single());
    if (p.pin_hash) throw new HttpError(409, "이미 PIN이 있습니다. 변경은 관리자 초기화 후 가능합니다");
    must(await ctx.db.rpc("set_pin", { p_person: ctx.me.id, p_pin: String(ctx.payload.pin ?? "") }));
    await logAccess(ctx, "pin_set");
    return { ok: true };
  },

  // PIN 확인: { pin } → 맞으면 설정 시간 동안 민감 기능 열림
  async "pin.verify"(ctx) {
    const ok = must(await ctx.db.rpc("verify_pin", { p_person: ctx.me.id, p_pin: String(ctx.payload.pin ?? "") }));
    await logAccess(ctx, ok ? "pin_success" : "pin_fail");
    if (!ok) throw new HttpError(401, "PIN이 틀렸거나 잠겨 있습니다");
    return { ok: true };
  },
};


// ---------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST만 허용됩니다" }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    // 로그인 전에도 쓰는 공개 기능: 로그인 버튼용 봇 아이디
    if (body.action === "public.bot") return json({ ok: true, data: { username: await getBotUsername() } });

    // pg_cron(10분마다)이 부르는 자동 알림. 텔레그램 로그인 대신 vault의 비밀값으로 확인
    if (body.action === "cron.reminders" || body.action === "cron.betaMenu") {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const secret = req.headers.get("x-cron-secret") ?? "";
      if (!secret || !must(await admin.rpc("check_cron_secret", { p_secret: secret }))) throw new HttpError(401, "인증 실패");
      return json({ ok: true, data: body.action === "cron.betaMenu" ? await betaMenuAll(admin) : await cronReminders(admin) });
    }

    // 텔레그램 미니앱(initData) 또는 PC 브라우저 로그인 버튼(x-telegram-login) 중 하나로 확인
    const initData = req.headers.get("x-telegram-init-data") ?? "";
    const login = req.headers.get("x-telegram-login") ?? "";
    if (!initData && !login) throw new HttpError(401, "텔레그램 인증 정보가 없습니다");
    const tgUser = initData ? await verifyInitData(initData) : await verifyLoginWidget(login);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const me = must(await admin.from("people")
      .select("id, name, is_active, bot_menu_url")
      .eq("telegram_user_id", tgUser.id)
      .maybeSingle());
    // 등록 안 된 사람: 본인 텔레그램 번호를 돌려줘서 화면에 띄움 (본인 번호라 비밀 아님) → 캡처해서 팀장에게 보내면 등록
    if (!me) throw new HttpError(403, "등록되지 않은 사용자입니다. 관리자에게 문의하세요", {
      code: "not_registered", tg_id: tgUser.id, tg_name: (tgUser as { first_name?: string }).first_name ?? null,
    });
    if (!me.is_active) throw new HttpError(403, "비활성화된 계정입니다. 관리자에게 문의하세요");
    // 앱을 켤 때(me) 한 번: 이 사람 채팅의 왼쪽 아래 메뉴 버튼을 베타로 (이미 했으면 건너뜀)
    if (body.action === "me") await ensureBetaMenu(admin, me, tgUser.id).catch((e) => console.error("menu", e));

    // 수정 이력에 '누가'를 남기기 위해 요청 헤더에 행위자 id를 실어 보냄
    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
      global: { headers: { "x-actor-id": me.id } },
    });

    const handler = actions[body.action];
    if (!handler) throw new HttpError(400, `알 수 없는 기능입니다: ${body.action}`);

    const data = await handler({ db, me, payload: body.payload ?? {} });
    return json({ ok: true, data });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ ok: false, error: status === 500 ? "서버 오류가 발생했습니다" : e.message, ...(e instanceof HttpError ? e.extra ?? {} : {}) }, status);
  }
});
