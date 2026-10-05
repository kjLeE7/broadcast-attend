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
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then((x) => x.json()).catch(() => null);
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
function visibleToMe(row: any, rank: number, groups: string[], meId?: string) {
  if (row.target_people?.length) return rank >= RANK.GROUP_LEADER || (!!meId && row.target_people.includes(meId));
  return rank >= RANK.GROUP_LEADER || !row.target_unit_id || groups.includes(row.target_unit_id);
}
// 대상자로 콕 집힌 모임이면 다른 팀 사람도 그 모임은 볼 수 있음
function inTargets(s: any, meId: string) { return !!s.target_people?.includes(meId); }
async function requireSessionMember(ctx: Ctx, s: any) {
  if (inTargets(s, ctx.me.id)) return;
  await requireRank(ctx, s.team_id, RANK.MEMBER);
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
// 모임에 붙은 체크인(기상·출발·도착)도 같이: checkins: [{ id, items }]
const SESSION_COLS = "*, meeting_types(name), checkins(id, items)";

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
async function sessionMembers(ctx: Ctx, s: any, withTelegram = false): Promise<any[]> {
  if (s.target_people?.length) return await targetPeopleMembers(ctx, s, withTelegram);
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

// 사람으로 집은 모임의 대상자: 그 사람들의 그날 가장 높은 직책(과·팀 안), 조
async function targetPeopleMembers(ctx: Ctx, s: any, withTelegram: boolean) {
  const ids: string[] = s.target_people;
  const day = s.session_date;
  const [ppl, pos, gs] = await Promise.all([
    ctx.db.from("people").select(`id, name, is_active${withTelegram ? ", telegram_user_id" : ""}`).in("id", ids),
    ctx.db.from("position_history").select("person_id, positions(name, rank)").in("person_id", ids)
      .lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`),
    ctx.db.from("group_assignments").select("person_id, group_unit_id, org_units(name)").in("person_id", ids)
      .lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`),
  ]);
  const top = new Map<string, any>();
  for (const r of must(pos as any) ?? []) {
    const cur = top.get(r.person_id);
    if (!cur || (r.positions?.rank ?? 0) > cur.rank) top.set(r.person_id, { name: r.positions?.name ?? "", rank: r.positions?.rank ?? 0 });
  }
  const grp = new Map<string, any>();
  for (const g of must(gs as any) ?? []) if (!grp.has(g.person_id)) grp.set(g.person_id, g);
  return (must(ppl as any) ?? []).filter((p: any) => p.is_active).map((p: any) => ({
    id: p.id, name: p.name, position: top.get(p.id)?.name ?? "", rank: top.get(p.id)?.rank ?? 0,
    group: grp.get(p.id)?.org_units?.name ?? null, group_id: grp.get(p.id)?.group_unit_id ?? null,
    telegram_user_id: p.telegram_user_id ?? null,
  })).sort((a: any, b: any) => (a.group ?? "힣").localeCompare(b.group ?? "힣") || b.rank - a.rank || a.name.localeCompare(b.name));
}

// 모임 대상 고르기용: 과의 팀들, 팀마다 조, 사람마다 팀별 직책 서열 (직접 받은 직책만. 위에서 상속된 직책은 뺌)
async function sectionRoster(ctx: Ctx, teamId: string) {
  const units = await sectionUnits(ctx, teamId);
  const day = kstToday();
  const [unitRows, pos, groupUnits] = await Promise.all([
    ctx.db.from("org_units").select("id, name, unit_type").in("id", units),
    ctx.db.from("position_history").select("person_id, org_unit_id, people(name, is_active), positions(name, rank)")
      .in("org_unit_id", units).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`),
    ctx.db.from("org_units").select("id, name, parent_id").in("parent_id", units).eq("unit_type", "조").is("ended_on", null).order("name"),
  ]);
  const U = must(unitRows as any) ?? [];
  const section = U.find((u: any) => u.unit_type !== "팀") ?? { id: units[0], name: "방송예술과" };
  const teams = U.filter((u: any) => u.unit_type === "팀").sort((a: any, b: any) => a.name.localeCompare(b.name));
  const people = new Map<string, any>();
  for (const r of must(pos as any) ?? []) {
    if (!r.people?.is_active) continue;
    const p = people.get(r.person_id) ?? { id: r.person_id, name: r.people.name, position: "", rank: 0, ranks: {} as Record<string, number>, pos: {} as Record<string, string>, group: null, group_id: null };
    const rk = r.positions?.rank ?? 0;
    if (rk >= (p.ranks[r.org_unit_id] ?? 0)) p.pos[r.org_unit_id] = r.positions?.name ?? "";
    p.ranks[r.org_unit_id] = Math.max(p.ranks[r.org_unit_id] ?? 0, rk);
    if (rk > p.rank) { p.rank = rk; p.position = r.positions?.name ?? ""; }
    people.set(r.person_id, p);
  }
  const ids = [...people.keys()];
  const G = must(groupUnits as any) ?? [];
  if (ids.length && G.length) {
    const gs: any[] = must(await ctx.db.from("group_assignments").select("person_id, group_unit_id").in("person_id", ids)
      .in("group_unit_id", G.map((g: any) => g.id)).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
    for (const g of gs) { const p = people.get(g.person_id); p.group_id = g.group_unit_id; p.group = G.find((x: any) => x.id === g.group_unit_id)?.name ?? null; }
  }
  return {
    section, teams: teams.map((t: any) => ({ id: t.id, name: t.name, groups: G.filter((g: any) => g.parent_id === t.id).map((g: any) => ({ id: g.id, name: g.name })) })),
    members: [...people.values()].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
  };
}

// 대상 고르기 화면에서 사람으로 집은 경우 검사: 만드는 팀(team_id)에서 teamRank 이상(전체면 allRank 이상)
// 사람은 같은 과 안이면 다른 팀 사람도 됨(타팀과 함께하는 모임·공지·체크인·과제, 2026-10-05)
// { team_id, scope: team|all|section, target_people? } → 사람 id 배열 또는 null(예전처럼 팀·조 대상)
async function pickedPeople(ctx: Ctx, p: any, teamRank: number, allRank: number): Promise<string[] | null> {
  if (!Array.isArray(p.target_people)) return null;
  const ids = [...new Set(p.target_people.map(String))] as string[];
  if (!ids.length) throw new HttpError(400, "대상자를 한 명 이상 골라주세요");
  if (ids.length > 300) throw new HttpError(400, "대상이 너무 많아요");
  const all = p.scope === "all" || p.scope === "section";
  await requireRank(ctx, p.team_id, all ? allRank : teamRank);
  const roster = await sectionRoster(ctx, p.team_id);
  const ok = new Set(roster.members.map((m: any) => m.id));
  if (ids.some((id) => !ok.has(id))) throw new HttpError(400, "대상자 명단이 올바르지 않습니다");
  return ids;
}
const labelOf = (p: any) => String(p.target_label ?? "").slice(0, 60) || null;
// 그 줄(과제·체크인)의 대상자로 집혔거나, 그 팀 사람이면 통과
async function requireItemMember(ctx: Ctx, row: any) {
  if (row.target_people?.includes(ctx.me.id)) return;
  await requireRank(ctx, row.team_id, RANK.MEMBER);
}
// 과제 제출·체크인 보고: 그 글의 대상인 사람만 (사람으로 집었으면 그 사람, 조 대상이면 그 조 + 조장 이상)
async function requireItemTarget(ctx: Ctx, row: any) {
  if (row.target_people?.length) {
    if (row.target_people.includes(ctx.me.id)) return;
    throw new HttpError(403, "이 글의 대상이 아니에요");
  }
  const rank = await rankIn(ctx, row.team_id);
  if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");
  if (row.target_unit_id && rank < RANK.GROUP_LEADER && !(await myGroupIds(ctx)).includes(row.target_unit_id)) throw new HttpError(403, "이 글의 대상이 아니에요");
}
// 조 id가 이 팀의 조인지 (아니면 400)
async function checkGroup(ctx: Ctx, teamId: string, unitId: any) {
  if (!unitId) return null;
  const g = must(await ctx.db.from("org_units").select("parent_id, unit_type").eq("id", unitId).maybeSingle());
  if (!g || g.parent_id !== teamId || g.unit_type !== "조") throw new HttpError(400, "이 팀의 조가 아닙니다");
  return unitId as string;
}
// 같은 사람이 같은 일을 짧은 시간에 너무 많이 하지 못하게 (알림 폭탄 막기)
async function rateLimit(ctx: Ctx, kind: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await ctx.db.from("action_limits").select("id", { count: "exact", head: true }).eq("person_id", ctx.me.id).eq("kind", kind).gte("at", since);
  if ((count ?? 0) >= max) throw new HttpError(429, `잠시 뒤에 다시 해주세요 (${minutes}분에 ${max}번까지)`);
  await ctx.db.from("action_limits").insert({ person_id: ctx.me.id, kind });
}
const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v);

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
  const done = must(await ctx.db.from("meeting_sessions")
    .update({ closed_at: new Date().toISOString(), status: "완료" })
    .eq("id", s.id).select(SESSION_COLS).single());
  await awardBadges(ctx, members.map((m: any) => m.id));
  return done;
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
    (kind !== "cancel" && s.description ? "\n\n📝 " + escHtml(String(s.description).slice(0, 300)) + (String(s.description).length > 300 ? "…" : "") : "") +
    (kind === "cancel" ? "" : "\n\n미니앱에서 참석·지각·불참을 미리 체크해주세요.") +
    (kind !== "cancel" && sessionCheckinItems(s).length
      ? `\n그날은 ${sessionCheckinItems(s).map((x) => CHECKIN_EMOJI[x] + x).join("·")} 보고도 받아요. 봇에 '${sessionCheckinItems(s)[0]}'처럼 보내면 바로 기록돼요.` : "");
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

function sessionCheckinItems(s: any): string[] {
  const all = new Set<string>();
  for (const c of s.checkins ?? []) for (const it of c.items ?? []) all.add(it);
  return ["기상", "출발", "도착"].filter((x) => all.has(x));
}
function checkButton(s: any) {
  return { inline_keyboard: [[{ text: "출결 체크하기", web_app: { url: `${MINIAPP_URL}?s=${s.id}` } }]] };
}
// 여러 사람에게 봇 메시지 (텔레그램 초당 제한 때문에 20명씩). 봇을 시작하지 않은 사람은 failed에 이름
// 텔레그램이 거절한 이유를 쉬운 말로 (원문은 함수 로그에)
function tgWhy(desc: string) {
  if (/initiate conversation|chat not found|user not found/i.test(desc)) return "봇과 대화를 시작하지 않음";
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
      } catch (e: any) { failed.push(m.name); why[m.name] = "보내기 실패(네트워크)"; console.error("tg fetch", m.name, e?.name ?? "error"); }
    }));
  }
  return { sent, failed, why };
}

// ----- 공지·과제 확인 기록 -----
// 그 글을 받는 사람(쓴 사람 제외)과, 확인 명단을 볼 수 있는지
async function readTarget(ctx: Ctx, kind: string, id: string) {
  if (kind === "notice") {
    const n = must(await ctx.db.from("notices").select("id, team_id, target_unit_id, target_positions, target_people, created_by").eq("id", id).maybeSingle());
    if (!n) throw new HttpError(404, "공지를 찾을 수 없습니다");
    const unit = must(await ctx.db.from("org_units").select("unit_type").eq("id", n.team_id).single());
    const rank = await rankIn(ctx, n.team_id);
    const canSee = n.created_by === ctx.me.id || rank >= (unit.unit_type === "팀" ? RANK.INSTRUCTOR : RANK.TEAM_LEADER);
    return {
      team_id: n.team_id, rank, canSee, by: n.created_by, inTarget: !!n.target_people?.includes(ctx.me.id),
      audience: async () => n.target_people?.length
        ? (await targetPeopleMembers(ctx, { target_people: n.target_people, session_date: kstToday() }, false)).filter((m: any) => m.id !== n.created_by)
        : (await unitAudience(ctx, n.team_id)).filter((m) =>
        m.id !== n.created_by && (!n.target_unit_id || m.group_id === n.target_unit_id) &&
        (!n.target_positions?.length || n.target_positions.includes(m.code))),
    };
  }
  if (kind === "assignment") {
    const a = must(await ctx.db.from("assignments").select("id, team_id, target_unit_id, target_people, created_by").eq("id", id).maybeSingle());
    if (!a) throw new HttpError(404, "과제를 찾을 수 없습니다");
    const rank = await rankIn(ctx, a.team_id);
    return {
      team_id: a.team_id, rank, canSee: a.created_by === ctx.me.id || rank >= RANK.GROUP_LEADER, by: a.created_by,
      inTarget: !!a.target_people?.includes(ctx.me.id),
      audience: async () => (await sessionMembers(ctx, { team_id: a.team_id, session_date: kstToday(), target_unit_id: a.target_unit_id, target_people: a.target_people }))
        .filter((m) => m.id !== a.created_by),
    };
  }
  if (kind === "session") {   // 모임 (첨부 파일용)
    const m = must(await ctx.db.from("meeting_sessions").select("id, team_id, target_unit_id, target_people, created_by, session_date").eq("id", id).maybeSingle());
    if (!m) throw new HttpError(404, "모임을 찾을 수 없습니다");
    const rank = await rankIn(ctx, m.team_id);
    return {
      team_id: m.team_id, rank, canSee: m.created_by === ctx.me.id || rank >= RANK.GROUP_LEADER, by: m.created_by, inTarget: !!m.target_people?.includes(ctx.me.id), date: m.session_date,
      audience: async () => await sessionMembers(ctx, m),
    };
  }
  throw new HttpError(400, "종류가 올바르지 않습니다");
}
// 목록 카드에 붙일 '확인 N명' (볼 수 있는 글만, 쓴 사람 제외)
// + 내가 이미 확인했는지(seen)
async function readCounts(ctx: Ctx, kind: string, rows: any[]) {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, number>(), seen = new Set<string>();
  if (!ids.length) return { counts: out, seen };
  const reads: any[] = must(await ctx.db.from("content_reads").select("item_id, person_id").eq("kind", kind).in("item_id", ids)) ?? [];
  const by = new Map(rows.map((r) => [r.id, r.created_by]));
  for (const r of reads) {
    if (r.person_id === ctx.me.id) seen.add(r.item_id);
    if (r.person_id !== by.get(r.item_id)) out.set(r.item_id, (out.get(r.item_id) ?? 0) + 1);
  }
  return { counts: out, seen };
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
// ----- 과·팀에 지금 직책이 있는 활성 인원 (업무가능 독촉·생일에 씀) -----
async function unitMembers(ctx: Ctx, unitIds: string[]) {
  const day = kstToday();
  const pos: any[] = must(await ctx.db.from("position_history")
    .select("person_id, people(name, is_active, telegram_user_id, birth_date)")
    .in("org_unit_id", unitIds).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
  const out = new Map<string, any>();
  for (const r of pos) {
    if (!r.people?.is_active || out.has(r.person_id)) continue;
    out.set(r.person_id, { id: r.person_id, name: r.people.name, telegram_user_id: r.people.telegram_user_id, birth_date: r.people.birth_date });
  }
  return [...out.values()];
}
// 팀 → 그 팀이 속한 과와 과의 모든 팀
async function sectionUnits(ctx: Ctx, teamId: string) {
  const team = must(await ctx.db.from("org_units").select("id, parent_id, unit_type").eq("id", teamId).maybeSingle());
  const sectionId = team?.unit_type === "팀" ? team.parent_id : teamId;
  const kids: any[] = must(await ctx.db.from("org_units").select("id").eq("parent_id", sectionId).eq("unit_type", "팀").is("ended_on", null)) ?? [];
  return [sectionId, ...kids.map((k) => k.id)];
}

// ----- 홈: 과 전체 일정 모으기 (오늘의 트랙·준비 중·월 달력이 같이 씀) -----
// 팀 하나로 과(방송예술과)와 그 아래 팀들을 찾음
async function sectionOf(ctx: Ctx, teamId: string) {
  const team = must(await ctx.db.from("org_units").select("id, parent_id").eq("id", teamId).maybeSingle());
  const sectionId = team?.parent_id ?? teamId;
  const kids: any[] = must(await ctx.db.from("org_units").select("id, name")
    .eq("parent_id", sectionId).eq("unit_type", "팀").is("ended_on", null)) ?? [];
  const teamIds = kids.map((k) => k.id);
  return { sectionId, kids, teamIds, unitIds: [sectionId, ...teamIds], unitName: new Map<string, string>(kids.map((k) => [k.id, k.name])) };
}
// 과 안 어느 팀에서든 교관 이상이면 녹음·사회의 구체적인 제목을 봄 (동네지도와 같은 규칙)
async function canSeeDetail(ctx: Ctx, teamIds: string[]) {
  let m = 0;
  for (const t of teamIds) m = Math.max(m, await rankIn(ctx, t));
  return m >= RANK.INSTRUCTOR;
}
// [from, to) 사이의 모임·녹음·업무·사명자 일정을 한 모양으로
// kind: 모임 | 녹음 | 사회·촬영·편집 | 일정 | 기타
async function sectionItems(ctx: Ctx, sec: any, from: number, to: number, canDetail: boolean) {
  const { teamIds, unitIds, unitName } = sec;
  const label = (id: string) => unitName.get(id) ?? "방송예술과";
  const iso = [new Date(from).toISOString(), new Date(to).toISOString()];
  const kd = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
  const none = Promise.resolve({ data: [], error: null });
  const [sess, recs, duty, staff] = await Promise.all([
    teamIds.length ? ctx.db.from("meeting_sessions")
      .select("id, team_id, title, session_date, start_time, end_time, location, status, target_label, created_by, meeting_types(name)")
      .in("team_id", teamIds).gte("session_date", kd(from)).lte("session_date", kd(to - 1)).neq("status", "취소") : none,
    teamIds.length ? ctx.db.from("recording_sessions")
      .select("id, team_id, scheduled_start, scheduled_end, location, status, recording_requests(title, request_code)")
      .in("team_id", teamIds).gte("scheduled_start", iso[0]).lt("scheduled_start", iso[1]) : none,
    ctx.db.from("duties").select("id, unit_id, duty_type, title, owner_id, place, starts_at, ends_at, recording_session_id")
      .in("unit_id", unitIds).gte("starts_at", iso[0]).lt("starts_at", iso[1]),
    ctx.db.from("staff_schedules").select("id, unit_id, title, category, place, organizer_id, organizer_role, starts_at, ends_at")
      .in("unit_id", unitIds).gte("starts_at", iso[0]).lt("starts_at", iso[1]),
  ]);
  const M = must(sess as any) ?? [], R = (must(recs as any) ?? []).filter((r: any) => ["예정", "완료", "재녹음필요"].includes(r.status));   // 조율 중인 회차는 아직 안 보임
  const D = (must(duty as any) ?? []).filter((d: any) => !d.recording_session_id), S = must(staff as any) ?? [];
  const names = await nameMap(ctx, [...D.map((d: any) => d.owner_id), ...S.map((s: any) => s.organizer_id), ...M.map((m: any) => m.created_by)]);
  const DK: Record<string, string> = { "녹음": "녹음", "사회": "사회·촬영·편집", "촬영": "사회·촬영·편집", "음향편집": "사회·촬영·편집" };
  const items: any[] = [];
  for (const s of M) {
    const st = sessionStart(s) ?? kstMs(s.session_date, "00:00:00");
    items.push({ src: "session", id: s.id, kind: "모임", type: s.meeting_types?.name ?? "모임", team: label(s.team_id),
      title: sessionName(s), start: st, end: sessionEnd(s), allDay: !s.start_time, place: s.location ?? "",
      who: s.target_label ?? "", lead: names.get(s.created_by) ?? "" });
  }
  for (const r of R) {
    const st = Date.parse(r.scheduled_start), req = r.recording_requests;
    items.push({ src: "rec", id: r.id, kind: "녹음", type: "녹음", team: label(r.team_id),
      title: canDetail && req ? [req.title, req.request_code].filter(Boolean).join(" · ") : "녹음",
      start: st, end: r.scheduled_end ? Date.parse(r.scheduled_end) : st + 2 * HOUR, place: r.location ?? "", who: "", lead: "" });
  }
  for (const d of D) {
    const st = Date.parse(d.starts_at), kind = DK[d.duty_type] ?? "기타";
    const gated = d.duty_type === "녹음" || d.duty_type === "사회";
    items.push({ src: "duty", id: d.id, kind, type: d.duty_type, team: label(d.unit_id),
      title: gated && !canDetail ? d.duty_type : (d.title || d.duty_type),
      start: st, end: d.ends_at ? Date.parse(d.ends_at) : st + 3 * HOUR, place: d.place ?? "", who: names.get(d.owner_id) ?? "", lead: "" });
  }
  for (const s of S) {
    const st = Date.parse(s.starts_at);
    items.push({ src: "staff", id: s.id, kind: "일정", type: s.category ?? "", team: label(s.unit_id),
      title: s.title, start: st, end: s.ends_at ? Date.parse(s.ends_at) : st + HOUR, place: s.place ?? "",
      who: names.get(s.organizer_id) ?? "", lead: s.organizer_role ?? "" });
  }
  return items.sort((a, b) => a.start - b.start);
}
// 팀마다 지금 인원 (활성, 오늘 유효한 직책)
async function teamHeadcounts(ctx: Ctx, kids: any[]) {
  const today = kstToday(), out: Record<string, number> = {};
  if (!kids.length) return out;
  const rows: any[] = must(await ctx.db.from("position_history").select("person_id, org_unit_id, people(is_active)")
    .in("org_unit_id", kids.map((k) => k.id)).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
  for (const k of kids) out[k.name] = new Set(rows.filter((r) => r.org_unit_id === k.id && r.people?.is_active).map((r) => r.person_id)).size;
  return out;
}

// ----- 녹음 요청: 받기 → 배역 → 회차(시간·장소·사람 제안) → 각자 수락/조율 → 모두 확정되면 녹음 일정 -----
// 녹음 관계자 = 과 안 세 팀 어디서든 교관 이상 (내 업무가 아니어도 서로 공유)
// 회차(recording_sessions) 상태: 조율중(제안을 보내고 답을 기다림) → 예정(모두 확정) → 완료 / 취소
// 사람(recording_participants): answer 대기·수락·조율·미선정, selected = 이 회차에 실제로 들어가는 사람
const REC_ROLE: Record<string, string> = { voice: "녹음자", engineer: "엔지니어", director: "감독자" };
const REC_ROLE_KO: Record<string, string> = { "녹음자": "성우", "엔지니어": "엔지니어", "감독자": "감독" };
const REC_STATUS = ["접수", "캐스팅중", "일정확정", "녹음완료", "편집완료", "전달완료", "보류", "취소"];
const REC_ACTIVE = ["조율중", "예정"];
const SLOT_MS = 30 * 60000;
function msLabel(ms: number) {
  const d = new Date(ms + 9 * HOUR);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd}) ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
function hmLabel(ms: number) { return msLabel(ms).slice(-5); }
function overlaps(list: [number, number][] | undefined, s: number, e: number) {
  return !!list?.some(([a, b]) => a < e && s < b);
}
// 예상 녹음 시간(분) → 잡는 칸 수(30분 단위, 10분 내외도 30분 한 칸)
function recSlots(dur: number) { return Math.max(1, Math.ceil((dur || 30) / 30)); }
// 이 팀이 속한 과에서 녹음 관계자인지 확인하고 과 정보를 돌려줌
async function recSection(ctx: Ctx, teamId: string) {
  const sec = await sectionOf(ctx, teamId);
  if (!(await canSeeDetail(ctx, sec.teamIds))) throw new HttpError(403, "녹음 요청은 세 팀 교관 이상만 볼 수 있어요");
  return sec;
}
async function recRequest(ctx: Ctx, id: string) {
  const row = must(await ctx.db.from("recording_requests").select("*").eq("id", id).maybeSingle());
  if (!row) throw new HttpError(404, "녹음 요청을 찾을 수 없습니다");
  return { row, sec: await recSection(ctx, row.team_id) };
}
// 배역이 없는 예전 요청이면 필요한 성우 수만큼 만들어 둠
async function recRoles(ctx: Ctx, row: any) {
  let roles: any[] = must(await ctx.db.from("recording_roles").select("id, name, sort_order, session_id, pref_method, pref_people").eq("request_id", row.id).order("sort_order")) ?? [];
  if (!roles.length) {
    const n = Math.max(1, row.voices_needed ?? 1);
    roles = must(await ctx.db.from("recording_roles").insert(Array.from({ length: n }, (_, i) => ({ request_id: row.id, name: n === 1 ? "성우" : `배역${i + 1}`, sort_order: i })))
      .select("id, name, sort_order, session_id, pref_method, pref_people")) ?? [];
  }
  return roles;
}
// 과 사람들 + 녹음 역할: 성우 = 성우팀 소속, 엔지니어 = 엔지니어팀 소속, 감독 = 어느 팀이든 교관 이상
async function recPeople(ctx: Ctx, sec: any) {
  const roster = await sectionRoster(ctx, sec.teamIds[0] ?? sec.sectionId);
  const vt = sec.kids.find((k: any) => k.name === "성우팀")?.id, et = sec.kids.find((k: any) => k.name === "엔지니어팀")?.id;
  return roster.members.map((m: any) => {
    const team = sec.kids.find((k: any) => m.ranks[k.id] !== undefined)?.name ?? "방송예술과";
    return {
      id: m.id, name: m.name, team, position: m.position, rank: m.rank,
      voice: !!vt && m.ranks[vt] !== undefined, engineer: !!et && m.ranks[et] !== undefined, director: m.rank >= RANK.INSTRUCTOR,
    };
  });
}
async function withTelegram(ctx: Ctx, ids: string[]) {
  if (!ids.length) return [];
  return must(await ctx.db.from("people").select("id, name, telegram_user_id").in("id", ids).eq("is_active", true)) ?? [];
}
function recButton(id: string) {
  return { inline_keyboard: [[{ text: "녹음 요청 보기", web_app: { url: `${MINIAPP_URL}?rec=${id}` } }]] };
}
function askButton(pid: string) {
  return { inline_keyboard: [[{ text: "수락 / 조율 응답하기", web_app: { url: `${MINIAPP_URL}?ask=${pid}` } }]] };
}
// 장소 글자 → 장소 코드 (긴 별칭부터)
function placeMatcher(rows: any[]) {
  const norm = (s: any) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
  const list: [string, string][] = [];
  for (const p of rows) for (const a of [p.name, ...(p.aliases ?? [])]) if (norm(a)) list.push([norm(a), p.code]);
  list.sort((a, b) => b[0].length - a[0].length);
  return (loc: any) => { const n = norm(loc); if (!n) return null; for (const [a, c] of list) if (n.includes(a)) return c; return null; };
}
// 이 사람이 이 회차에서 무엇을 맡는지 (알림 글)
function partLabel(p: any, roleName?: string) {
  const ko = REC_ROLE_KO[p.role] ?? p.role;
  if (p.role === "녹음자") return `성우${roleName ? ` · 배역 '${roleName}'` : ""}${p.method ? ` (${p.method})` : ""}`;
  if (p.role === "엔지니어" && p.starts_at) return `${ko} ${hmLabel(Date.parse(p.starts_at))}~${hmLabel(Date.parse(p.ends_at))} (교대)`;
  return ko;
}
// 한 회차 불러오기 (참여자·배역 포함)
async function recSessionFull(ctx: Ctx, sid: string) {
  const s = must(await ctx.db.from("recording_sessions")
    .select("id, team_id, request_id, title, scheduled_start, scheduled_end, location, status, created_by, confirmed_at, started_at, ended_at, recording_participants(*)")
    .eq("id", sid).maybeSingle());
  if (!s) throw new HttpError(404, "녹음 회차를 찾을 수 없습니다");
  return s;
}
// 제안 받은 사람에게 알림 (사람마다 버튼이 달라서 한 명씩)
async function recAsk(ctx: Ctx, req: any, s: any, parts: any[], roleNames: Map<string, string>, lead = "🎙 <b>녹음 요청이 왔어요</b>") {
  const people = await withTelegram(ctx, [...new Set(parts.map((p) => p.person_id))]);
  const tg = new Map(people.map((p: any) => [p.id, p]));
  let sent = 0; const failed: string[] = []; const why: Record<string, string> = {};
  for (const p of parts) {
    const m = tg.get(p.person_id); if (!m) continue;
    const st = Date.parse(s.scheduled_start), en = Date.parse(s.scheduled_end);
    const text = [
      lead,
      `<b>${escHtml(req.title ?? "녹음")}</b>${req.request_code ? " · " + escHtml(req.request_code) : ""}`,
      `맡을 일: ${escHtml(partLabel(p, roleNames.get(p.role_id)))}`,
      `${msLabel(st)}~${hmLabel(en)} · ${escHtml(s.location ?? "")}`,
      `요청 ${escHtml(ctx.me.name)}`,
      ``, `아래 버튼을 눌러 수락 또는 조율을 골라주세요 🙏`,
    ].join("\n");
    const r = await sendToMembers([m], text, askButton(p.id));
    sent += r.sent; failed.push(...r.failed); Object.assign(why, r.why);
  }
  const ids = parts.map((p) => p.id);
  if (ids.length) await ctx.db.from("recording_participants").update({ notified_at: new Date().toISOString() }).in("id", ids);
  return { sent, failed, why };
}
// 요청 상태를 회차들에 맞춰 정리: 모든 배역이 예정/완료 회차에 들어가면 '일정확정'(다 완료면 '녹음완료'), 하나라도 진행 중이면 '캐스팅중', 아무것도 없으면 '접수'
async function recSyncStatus(ctx: Ctx, reqId: string) {
  const req = must(await ctx.db.from("recording_requests").select("id, status").eq("id", reqId).single());
  if (["보류", "취소", "편집완료", "전달완료"].includes(req.status)) return req.status;
  const roles: any[] = must(await ctx.db.from("recording_roles").select("session_id").eq("request_id", reqId)) ?? [];
  const sids = [...new Set(roles.map((r) => r.session_id).filter(Boolean))];
  const ss: any[] = sids.length ? must(await ctx.db.from("recording_sessions").select("id, status").in("id", sids)) ?? [] : [];
  const st = new Map(ss.map((s) => [s.id, s.status]));
  const each = roles.map((r) => (r.session_id ? st.get(r.session_id) : null));
  let next = "접수";
  if (each.length && each.every((x) => x === "완료")) next = "녹음완료";
  else if (each.length && each.every((x) => x === "예정" || x === "완료")) next = "일정확정";
  else if (each.some((x) => x === "조율중" || x === "예정" || x === "완료")) next = "캐스팅중";
  if (next !== req.status) await ctx.db.from("recording_requests").update({ status: next }).eq("id", reqId);
  return next;
}
// 다 모였는지 확인 → 모두 확정이면 회차를 '예정'으로, 뽑히지 않은 후보는 '미선정', 확정 알림
async function recFinalize(ctx: Ctx, sid: string) {
  const s = await recSessionFull(ctx, sid);
  if (s.status !== "조율중") return { done: s.status === "예정" };
  const roles: any[] = must(await ctx.db.from("recording_roles").select("id, name").eq("session_id", sid)) ?? [];
  const P: any[] = s.recording_participants ?? [];
  const ok = (p: any) => p.answer === "수락" && p.selected;
  const voicesOk = roles.every((r) => P.some((p) => p.role === "녹음자" && p.role_id === r.id && ok(p)));
  const eng = P.filter((p) => p.role === "엔지니어"), dir = P.filter((p) => p.role === "감독자");
  const done = roles.length > 0 && voicesOk && eng.length > 0 && eng.every(ok) && dir.length > 0 && dir.every(ok);
  if (!done) return { done: false };
  must(await ctx.db.from("recording_sessions").update({ status: "예정", confirmed_at: new Date().toISOString() }).eq("id", sid));
  const req = must(await ctx.db.from("recording_requests").select("id, title, request_code").eq("id", s.request_id).single());
  const losers = P.filter((p) => p.role === "녹음자" && !p.selected && ["대기", "수락"].includes(p.answer));
  if (losers.length) {
    must(await ctx.db.from("recording_participants").update({ answer: "미선정", answered_at: new Date().toISOString() }).in("id", losers.map((p) => p.id)));
    await sendToMembers(await withTelegram(ctx, losers.map((p) => p.person_id)),
      `🎙 <b>${escHtml(req.title ?? "녹음")}</b>\n이번 녹음은 다른 분이 맡게 됐어요. 응답해 주셔서 감사해요 🙏`);
  }
  const names = await nameMap(ctx, P.map((p) => p.person_id));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const sel = P.filter((p) => p.selected);
  const line = (role: string) => sel.filter((p) => p.role === role).map((p) => escHtml((names.get(p.person_id) ?? "") + (p.role_id && roleName.get(p.role_id) ? `(${roleName.get(p.role_id)})` : "") +
    (p.starts_at ? ` ${hmLabel(Date.parse(p.starts_at))}~${hmLabel(Date.parse(p.ends_at))}` : ""))).join(", ");
  const st = Date.parse(s.scheduled_start), en = Date.parse(s.scheduled_end);
  const text = [`✅ <b>녹음이 확정됐어요</b>`, `<b>${escHtml(req.title ?? "녹음")}</b>${req.request_code ? " · " + escHtml(req.request_code) : ""}${s.title ? " · " + escHtml(s.title) : ""}`,
    `${msLabel(st)}~${hmLabel(en)} · ${escHtml(s.location ?? "")}`, `성우 ${line("녹음자")}`, `엔지니어 ${line("엔지니어")}`, `감독 ${line("감독자")}`].join("\n");
  const ids = new Set(sel.map((p) => p.person_id)); if (s.created_by) ids.add(s.created_by);
  await sendToMembers(await withTelegram(ctx, [...ids]), text, { inline_keyboard: [[{ text: "방송예술과 열기", web_app: { url: MINIAPP_URL } }]] });
  await recSyncStatus(ctx, s.request_id);
  return { done: true };
}

// ----- 생일: 오늘 생일 + 일주일 안 생일 (월·일만, 나이는 안 보냄) -----
function bdayMd(birth: string, year: number) {
  const md = birth.slice(5, 10);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return md === "02-29" && !leap ? "02-28" : md;
}
async function birthdayInfo(ctx: Ctx, unitIds: string[]) {
  const today = kstToday(), year = +today.slice(0, 4);
  const people = (await unitMembers(ctx, unitIds)).filter((p) => p.birth_date);
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => addDaysStr(today, n));
  const list: any[] = [];
  for (const p of people) {
    const n = days.findIndex((d) => bdayMd(p.birth_date, +d.slice(0, 4)) === d.slice(5));
    if (n >= 0) list.push({ id: p.id, name: p.name, md: days[n].slice(5), in_days: n, me: p.id === ctx.me.id });
  }
  const todays = list.filter((b) => b.in_days === 0);
  let wished = new Set<string>(), mine: any[] = [];
  if (todays.length) {
    const rows: any[] = must(await ctx.db.from("birthday_wishes").select("person_id, from_id, message, sent_at")
      .eq("year", year).in("person_id", todays.map((b) => b.id))) ?? [];
    wished = new Set(rows.filter((r) => r.from_id === ctx.me.id).map((r) => r.person_id));
    const toMe = rows.filter((r) => r.person_id === ctx.me.id);
    const names = await nameMap(ctx, toMe.map((r) => r.from_id));
    mine = toMe.sort((a, b) => a.sent_at < b.sent_at ? -1 : 1).map((r) => ({ name: names.get(r.from_id) ?? "", message: r.message, at: r.sent_at }));
  }
  return {
    today: todays.map((b) => ({ id: b.id, name: b.name, me: b.me, wished: wished.has(b.id) })),
    soon: list.filter((b) => b.in_days > 0).sort((a, b) => a.in_days - b.in_days).map((b) => ({ name: b.name, md: b.md, in_days: b.in_days })),
    wishes_to_me: mine,
  };
}

// ----- 업무가능 시간: 마감(주일 22시) 뒤 미제출자에게 6시간마다 독촉 (밤 0~8시는 쉼) -----
const NAG_GAP = 6 * HOUR;
const NAG_FROM = "2026-10-05";   // 독촉 시작 주 (기능을 넣은 날 이미 끝나 가던 주는 건너뜀)
// 지금 기준 '마감이 지난 주'의 월요일 (주일 22시가 지나면 다음 주로 넘어감)
function nagWeek(now: number) {
  const k = new Date(now + 9 * HOUR), today = k.toISOString().slice(0, 10);
  const thisMon = addDaysStr(today, -((k.getUTCDay() + 6) % 7)), nextMon = addDaysStr(thisMon, 7);
  return now >= kstMs(addDaysStr(nextMon, -1), "22:00:00") ? nextMon : thisMon;
}
function weekLabel(ws: string) {
  const f = (d: string) => { const x = new Date(d + "T00:00:00Z"); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${"일월화수목금토"[x.getUTCDay()]})`; };
  return `${f(ws)} ~ ${f(addDaysStr(ws, 6))}`;
}
async function cronWeeklyNag(ctx: Ctx) {
  const now = Date.now();
  if (new Date(now + 9 * HOUR).getUTCHours() < 8) return null;   // 밤에는 안 보냄
  const ws = nagWeek(now);
  if (ws < NAG_FROM) return null;
  const row = must(await ctx.db.from("weekly_nags").select("*").eq("week_start", ws).maybeSingle());
  if (row && now - Date.parse(row.last_at) < NAG_GAP - 10 * 60000) return null;   // 10분마다 도니까 그만큼 여유
  const sections: any[] = must(await ctx.db.from("org_units").select("id").eq("unit_type", "과").is("ended_on", null)) ?? [];
  const units: string[] = [];
  for (const sec of sections) units.push(...await sectionUnits(ctx, sec.id));
  const members = await unitMembers(ctx, units);
  const subs: any[] = must(await ctx.db.from("weekly_submissions").select("person_id").eq("week_start", ws)) ?? [];
  const done = new Set(subs.map((x) => x.person_id));
  const targets = members.filter((m) => !done.has(m.id));
  if (!targets.length) return { week_start: ws, total: 0 };
  const deadline = addDaysStr(ws, -1);
  const text = `<b>📮 업무가능 시간이 아직 안 들어왔어요</b>\n\n${weekLabel(ws)}\n마감 ${weekLabel(deadline).split(" ~ ")[0]} 22:00 지남` +
    `\n\n미니앱 › 프로필 › 업무가능에서 되는 시간을 칠하고 저장해주세요. 되는 시간이 없으면 빈 채로 저장해도 돼요.`;
  const markup = { inline_keyboard: [[{ text: "업무가능 입력하기", web_app: { url: `${MINIAPP_URL}?go=weekly&ws=${ws}` } }]] };
  const { sent, failed, why } = await sendToMembers(targets, text, markup);
  const result = { sent, failed, why, total: targets.length, at: new Date(now).toISOString() };
  must(await ctx.db.from("weekly_nags").upsert({ week_start: ws, last_at: result.at, count: (row?.count ?? 0) + 1, result }));
  return { week_start: ws, ...result };
}

// ----- 시간취합 (가능시간 투표, 운영 앱에서 옮겨 옴) -----
// 칸 번호 = 날짜번호 × 48 + 30분칸(0 = 00:00~00:30)
const POLL_MAX_DAYS = 14;
function pollDates(p: any): string[] {
  const out: string[] = [];
  for (let d = p.start_date; d <= p.end_date && out.length < POLL_MAX_DAYS; d = addDaysStr(d, 1)) out.push(d);
  return out;
}
function pollOpen(p: any) { return p.status === "진행중" && Date.parse(p.deadline) > Date.now(); }
function canSeePoll(p: any, me: string) { return p.created_by === me || (p.target_people ?? []).includes(me); }
async function pollRow(ctx: Ctx, id: any) {
  const p = must(await ctx.db.from("time_polls").select("*").eq("id", String(id ?? "")).maybeSingle());
  if (!p || p.status === "취소") throw new HttpError(404, "시간취합을 찾을 수 없어요");
  if (!canSeePoll(p, ctx.me.id)) throw new HttpError(403, "이 시간취합의 대상이 아니에요");
  return p;
}
function pollButton(id: string, text = "가능시간 입력하기") {
  return { inline_keyboard: [[{ text, web_app: { url: `${MINIAPP_URL}?poll=${id}` } }]] };
}
function mdLabel(d: string) {
  const t = new Date(d + "T00:00:00Z");
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${"일월화수목금토"[t.getUTCDay()]})`;
}
function slotText(s: number) { return `${String(Math.floor(s / 2)).padStart(2, "0")}:${s % 2 ? "30" : "00"}`; }
// 같은 사람들이 되는 연속 칸을 하나로 묶어 '많이 되는 시간' 순으로
function pollBest(p: any, answers: any[], n: number) {
  const dates = pollDates(p), who = new Map<number, string[]>();
  for (const a of answers) {
    if (!(p.target_people ?? []).includes(a.person_id)) continue;
    for (const k of a.slots ?? []) { if (!who.has(k)) who.set(k, []); who.get(k)!.push(a.person_id); }
  }
  const runs: any[] = [];
  dates.forEach((_, di) => {
    let cur: any = null;
    for (let s = p.hour_from * 2; s < p.hour_to * 2; s++) {
      const set = (who.get(di * 48 + s) ?? []).slice().sort().join(",");
      if (cur && set && cur.set === set) { cur.end = s + 1; continue; }
      if (cur) runs.push(cur);
      cur = set ? { di, start: s, end: s + 1, set, n: set.split(",").length } : null;
    }
    if (cur) runs.push(cur);
  });
  runs.sort((x, y) => y.n - x.n || (y.end - y.start) - (x.end - x.start) || x.di - y.di || x.start - y.start);
  return runs.slice(0, n).map((r) => ({ label: `${mdLabel(dates[r.di])} ${slotText(r.start)}~${slotText(r.end)}`, n: r.n }));
}
async function pollWaiting(ctx: Ctx, p: any) {
  const ans: any[] = must(await ctx.db.from("time_poll_answers").select("person_id").eq("poll_id", p.id)) ?? [];
  const done = new Set(ans.map((a) => a.person_id));
  return (p.target_people ?? []).filter((id: string) => !done.has(id) && id !== p.created_by);
}
async function pollRemind(ctx: Ctx, p: any, lead: string) {
  const ids = await pollWaiting(ctx, p);
  const people = await withTelegram(ctx, ids);
  const text = `${lead}\n\n「${escHtml(p.title)}」\n${mdLabel(p.start_date)}${p.end_date !== p.start_date ? " ~ " + mdLabel(p.end_date) : ""}\n` +
    `마감 ${msLabel(Date.parse(p.deadline))}`;
  return { ...(await sendToMembers(people, text, pollButton(p.id))), total: ids.length };
}
// 마감: 만든 사람에게 결과(많이 되는 시간 3개 + 특이사항) 알림
async function pollFinish(ctx: Ctx, p: any) {
  const answers: any[] = must(await ctx.db.from("time_poll_answers").select("person_id, slots, memo").eq("poll_id", p.id)) ?? [];
  const best = pollBest(p, answers, 3);
  const names = await nameMap(ctx, answers.map((a) => a.person_id));
  const answered = answers.filter((a) => (p.target_people ?? []).includes(a.person_id)).length;
  const memos = answers.filter((a) => a.memo).map((a) => `· ${escHtml(names.get(a.person_id) ?? "")}: ${escHtml(a.memo)}`);
  const text = `<b>⏰ 시간취합이 마감됐어요</b>\n\n「${escHtml(p.title)}」 ${answered}/${(p.target_people ?? []).length}명 응답\n` +
    (best.length ? best.map((b, i) => `${i + 1}. ${b.label} (${b.n}명 가능)`).join("\n") : "겹치는 시간이 없어요.") +
    (memos.length ? `\n\n📝 특이사항\n${memos.join("\n")}` : "");
  const owner = await withTelegram(ctx, [p.created_by].filter(Boolean));
  const r = await sendToMembers(owner, text, pollButton(p.id, "결과 보기"));
  must(await ctx.db.from("time_polls").update({ status: "마감", closed_at: new Date().toISOString(), close_result: { sent: r.sent, why: r.why } }).eq("id", p.id));
  return r;
}
// 10분마다: 마감이 지난 취합은 마감 + 결과 알림, 마감 24시간 전에는 아직 안 한 사람에게 한 번 알림(밤 0~8시 제외)
async function cronPolls(ctx: Ctx) {
  const now = Date.now(), out: any[] = [];
  const rows: any[] = must(await ctx.db.from("time_polls").select("*").eq("status", "진행중")
    .lte("deadline", new Date(now + 24 * HOUR).toISOString())) ?? [];
  const night = new Date(now + 9 * HOUR).getUTCHours() < 8;
  for (const p of rows) {
    try {
      const due = Date.parse(p.deadline);
      if (due <= now) out.push({ id: p.id, finished: (await pollFinish(ctx, p)).sent });
      else if (!p.reminded_at && !night && Date.parse(p.created_at) < due - 24 * HOUR) {
        must(await ctx.db.from("time_polls").update({ reminded_at: new Date().toISOString() }).eq("id", p.id));
        out.push({ id: p.id, reminded: (await pollRemind(ctx, p, "<b>🔔 시간취합 마감이 다가와요</b>\n아직 입력 전이에요!")).sent });
      }
    } catch (e) { console.error("poll cron", p.id, e); }
  }
  return out;
}

// 10분마다 pg_cron이 부름: 72시간 전·24시간 전이 된 모임에 자동 알림 + 업무가능 독촉
async function cronReminders(db: any) {
  const ctx = { db, me: { id: null, name: "자동 알림" }, payload: {} } as unknown as Ctx;
  const today = kstToday();
  await db.from("action_limits").delete().lt("at", new Date(Date.now() - 86400000).toISOString());   // 하루 지난 횟수 기록은 지움
  await db.from("bot_updates").delete().lt("at", new Date(Date.now() - 86400000).toISOString());     // 봇 중복 확인 기록도
  await db.from("bot_waits").delete().lt("expires_at", new Date().toISOString());
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
  let weekly = null, polls = null;
  try { weekly = await cronWeeklyNag(ctx); } catch (e) { console.error("weekly nag", e); }
  try { polls = await cronPolls(ctx); } catch (e) { console.error("polls", e); }
  let dues = null, files = null;
  try { dues = await cronDuesNag(ctx); } catch (e) { console.error("dues nag", e); }
  try { files = await cronFiles(ctx); } catch (e) { console.error("files", e); }
  let meetings = null;
  try { meetings = await cronMeetings(ctx); } catch (e) { console.error("meetings", e); }
  return { sessions: out, weekly, polls, dues, files, meetings };
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
// 텔레그램 봇 채팅 답장 (운영 앱 Apps Script 웹훅에서 옮겨 옴)
// 채팅에 '출결'·'공지'·'기상' 같은 단어를 보내면 답장. 웹훅 전환은 cron.setWebhook
// ---------------------------------------------------------------------
const CHECKIN_ITEMS = ["기상", "출발", "도착"];
const CHECKIN_EMOJI: Record<string, string> = { "기상": "☀️", "출발": "🚗", "도착": "📍" };
// 단어 → 할 일 (앞의 '/'와 '@봇이름'은 떼고 봄)
const BOT_WORDS: Record<string, string[]> = {
  home: ["start", "앱", "방예과", "홈", "메뉴", "방송예술과", "열기"],
  attend: ["attend", "출결", "출석", "모임"],
  notice: ["notice", "공지"],
  poll: ["poll", "시간취합", "취합"],
  weekly: ["weekly", "업무가능", "녹음가능"],
  todo: ["todo", "할일", "할 일"],
  "기상": ["wake", "기상"],
  "출발": ["depart", "출발"],
  "도착": ["arrive", "도착"],
};
const BOT_COMMANDS = [
  { command: "start", description: "방송예술과 앱 열기" },
  { command: "attend", description: "출결" },
  { command: "notice", description: "공지 보기" },
  { command: "todo", description: "지금 할 일" },
  { command: "poll", description: "시간취합" },
  { command: "weekly", description: "업무가능 시간 입력" },
  { command: "wake", description: "기상 보고" },
  { command: "depart", description: "출발 보고" },
  { command: "arrive", description: "도착 보고" },
];
async function tgCall(method: string, payload: unknown) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then((x) => x.json());
    if (!r?.ok) console.error("tg", method, r?.error_code, r?.description);
    return r;
  } catch (e: any) { console.error("tg fetch", method, e?.name ?? "error"); return null; }
}
function botSend(chatId: number, text: string, markup?: unknown) {
  return tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: markup, disable_web_page_preview: true });
}
function appButton(label: string, query = "") {
  return { inline_keyboard: [[{ text: label, web_app: { url: MINIAPP_URL + query } }]] };
}
// "7:40", "07:40", "7시 40분", "19시", "7.40" → "07:40" / 못 읽으면 null
function parseHm(text: string) {
  const m = String(text).replace(/\s/g, "").match(/^(\d{1,2})(?:[:시.](\d{1,2})?분?)?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
function kstHm(ms: number) { return msLabel(ms).slice(-5); }
// 오늘 이 사람이 보고할 수 있는 체크인 (대상 규칙은 checkins.report의 requireItemTarget과 같음)
async function todayCheckins(ctx: Ctx) {
  const today = kstToday();
  const rows: any[] = must(await ctx.db.from("checkins").select("id, title, items, team_id, target_people, target_unit_id").eq("check_date", today)) ?? [];
  if (!rows.length) return [];
  const teams = new Map((await myTeams(ctx)).teams.map((t: any) => [t.id, t.rank]));
  const groups = await myGroupIds(ctx);
  return rows.filter((c) => {
    if (c.target_people?.length) return c.target_people.includes(ctx.me.id);
    const rank = teams.get(c.team_id) ?? 0;
    if (rank < RANK.MEMBER) return false;
    return !c.target_unit_id || rank >= RANK.GROUP_LEADER || groups.includes(c.target_unit_id);
  });
}
async function botRecord(ctx: Ctx, chatId: number, tgId: number, c: any, item: string) {
  const prev = must(await ctx.db.from("checkin_reports").select("reported_at").eq("checkin_id", c.id).eq("person_id", ctx.me.id).eq("item", item).maybeSingle());
  const now = new Date().toISOString();
  must(await ctx.db.from("checkin_reports").upsert({ checkin_id: c.id, person_id: ctx.me.id, item, reported_at: now, note: null }, { onConflict: "checkin_id,person_id,item" }));
  let text = `✅ ${escHtml(ctx.me.name)}님 [${escHtml(c.title)}] ${CHECKIN_EMOJI[item]}${item} ${kstHm(Date.parse(now))} 기록했어요.` +
    (prev ? `\n(이전 기록 ${kstHm(Date.parse(prev.reported_at))} → 새로 기록)` : "");
  if (item === "출발") {
    must(await ctx.db.from("bot_waits").upsert({ tg_user_id: tgId, kind: "eta", data: { checkin_id: c.id }, expires_at: new Date(Date.now() + 15 * 60000).toISOString() }));
    text += "\n\n도착 예정 시간은요? 예) 7:40  (모르면 그냥 넘어가도 돼요)";
  }
  return botSend(chatId, text);
}
const BOT_HELP = "이렇게 보내면 돼요 🙂\n\n• <b>앱</b> → 방송예술과 열기\n• <b>출결</b> → 모임·출결\n• <b>공지</b> → 공지 보기\n• <b>할일</b> → 지금 할 일\n" +
  "• <b>시간취합</b> · <b>업무가능</b> → 가능시간 입력\n\n체크인이 있는 날에는\n• <b>기상</b> / <b>출발</b> / <b>도착</b> → 바로 시간 기록";

async function handleTelegramUpdate(admin: any, u: any) {
  // 같은 메시지가 두 번 오면 무시
  if (typeof u.update_id === "number") {
    const { error } = await admin.from("bot_updates").insert({ update_id: u.update_id });
    if (error) return;   // 이미 처리함(기본키 중복)
  }
  const q = u.callback_query;
  const msg = u.message;
  const from = q?.from ?? msg?.from;
  if (!from?.id || from.is_bot) return;
  if (msg && (msg.chat?.type !== "private" || typeof msg.text !== "string")) return;   // 개인 채팅의 글자만
  if (q) tgCall("answerCallbackQuery", { callback_query_id: q.id });
  const chatId: number = q ? q.message?.chat?.id : msg.chat.id;
  if (!chatId) return;
  const tgId = Number(from.id);

  const person = must(await admin.from("people").select("id, name, is_active").eq("telegram_user_id", tgId).maybeSingle());
  if (!person) {
    if (q) return;
    return botSend(chatId, `아직 방송예술과 앱에 등록되지 않았어요.\n\n내 텔레그램 번호: <code>${tgId}</code>\n이 번호를 팀장님께 보내주시면 등록해 드려요.`);
  }
  if (!person.is_active) return q ? undefined : botSend(chatId, "비활성화된 계정이에요. 팀장님께 문의해주세요.");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, global: { headers: { "x-actor-id": person.id } } });
  const ctx = { db, me: { id: person.id, name: person.name }, payload: {} } as Ctx;

  // 체크인을 여러 개 중 골랐을 때: "ci|체크인id|항목"
  if (q) {
    const [kind, id, item] = String(q.data ?? "").split("|");
    if (kind !== "ci" || !CHECKIN_ITEMS.includes(item)) return;
    const c = (await todayCheckins(ctx)).find((x) => x.id === id);
    if (!c || !c.items.includes(item)) return botSend(chatId, "이미 끝났거나 없는 체크인이에요.");
    return botRecord(ctx, chatId, tgId, c, item);
  }

  const text = msg.text.trim();
  // '출발' 뒤 도착 예정 시간 답장을 기다리는 중이면
  const wait = must(await db.from("bot_waits").select("*").eq("tg_user_id", tgId).maybeSingle());
  if (wait) {
    must(await db.from("bot_waits").delete().eq("tg_user_id", tgId));
    const hm = parseHm(text);
    if (wait.kind === "eta" && hm && Date.parse(wait.expires_at) > Date.now()) {
      must(await db.from("checkin_reports").update({ note: `${hm} 도착 예정` })
        .eq("checkin_id", wait.data?.checkin_id).eq("person_id", person.id).eq("item", "출발"));
      return botSend(chatId, `✅ 도착 예정 ${hm} 기록했어요. 조심히 오세요! 🙏`);
    }
  }

  const word = text.replace(/^\//, "").replace(/@\w+/, "").split(/\s+/)[0].toLowerCase();
  const kind = Object.keys(BOT_WORDS).find((k) => BOT_WORDS[k].includes(word) || BOT_WORDS[k].includes(text.replace(/^\//, "")));
  if (kind === "home") return botSend(chatId, "방송예술과 앱이에요 👇", appButton("🏠 방송예술과 열기"));
  if (kind === "attend") return botSend(chatId, "모임·출결을 열어주세요 👇", appButton("📋 출결 열기", "?go=attend"));
  if (kind === "notice") return botSend(chatId, "공지를 확인하세요 👇", appButton("📢 공지 보기", "?go=notice"));
  if (kind === "poll") return botSend(chatId, "시간취합을 열어주세요 👇", appButton("📅 시간취합 열기", "?go=poll"));
  if (kind === "weekly") return botSend(chatId, "업무가능 시간을 입력해주세요 👇", appButton("🎙 업무가능 입력하기", "?go=weekly"));
  if (kind === "todo") {
    const t: any = await actions["todos.list"](ctx).catch(() => null);
    const n = t?.count ?? 0;
    return botSend(chatId, n ? `지금 할 일이 <b>${n}개</b> 있어요 👇` : "✅ 지금 할 일을 다 했어요", appButton("📝 개인노트 열기", "?go=profile"));
  }
  if (kind && CHECKIN_ITEMS.includes(kind)) {
    const list = (await todayCheckins(ctx)).filter((c) => (c.items ?? []).includes(kind));
    // '도착'은 지금 도착할 수 있는 녹음에도 도착으로 남김 (체크인이 없어도)
    if (kind === "도착") {
      const recs = await myArrivable(ctx);
      for (const r of recs) await recMarkArrived(ctx, r.s, r.pt);
      if (recs.length && !list.length) return botSend(chatId, `🎙 녹음실 도착을 기록했어요. 엔지니어님께 알렸어요!`);
      if (recs.length) await botSend(chatId, `🎙 녹음실 도착도 기록했어요.`);
    }
    if (!list.length) return botSend(chatId, `오늘 받는 '${kind}' 체크인이 없어요.`);
    if (list.length > 1) {
      return botSend(chatId, `어떤 일정의 ${kind}인가요?`, { inline_keyboard: list.map((c) => [{ text: c.title, callback_data: `ci|${c.id}|${kind}` }]) });
    }
    return botRecord(ctx, chatId, tgId, list[0], kind);
  }
  return botSend(chatId, BOT_HELP, appButton("🏠 방송예술과 열기"));
}
// 봇 웹훅을 이 함수로 돌림 (돌아가려면 Apps Script 편집기에서 setupBot 실행)
async function setWebhookHere(admin: any) {
  const secret = must(await admin.rpc("tg_webhook_secret"));
  if (!secret) throw new HttpError(500, "웹훅 비밀값 없음");
  const hook = await tgCall("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/api`, secret_token: secret,
    allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
  });
  const cmds = await tgCall("setMyCommands", { commands: BOT_COMMANDS });
  return { webhook: hook?.ok ?? false, commands: cmds?.ok ?? false };
}

// ---------------------------------------------------------------------
// 기능(action) 목록
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 성우 스탯: 교관이 실무 뒤 팀원에게 축별 경험치(XP)를 줌. 레벨은 저장 안 하고 지급 내역에서 계산
// ---------------------------------------------------------------------
const STAT_SOURCES = ["녹음", "수업", "스터디", "기타"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function statSettings(ctx: Ctx) {
  const rows: any[] = must(await ctx.db.from("app_settings").select("key,value").in("key", ["stat_grant_min_level", "stat_max_xp_per_grant", "stat_level"])) ?? [];
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const lv = v.get("stat_level") ?? {};
  return { min: Number(v.get("stat_grant_min_level") ?? 30), maxXp: Number(v.get("stat_max_xp_per_grant") ?? 12), factor: Number(lv.factor ?? 3), maxLevel: Number(lv.max ?? 10) };
}
// XP → 레벨 (다음 레벨 필요 XP = 현재 레벨 × factor). into = 이번 레벨에서 모은 XP, need = 다음 레벨까지 필요한 XP (최대 레벨이면 0)
function statLevel(xp: number, factor: number, maxLevel: number) {
  let level = 1, rest = xp;
  while (level < maxLevel && rest >= level * factor) { rest -= level * factor; level++; }
  return { level, into: rest, need: level < maxLevel ? level * factor : 0 };
}
// 스탯 축이 있는 팀 중 그 사람이 속한 첫 팀
// ponytail: 팀 하나만 (지금 축은 성우팀뿐). 다른 팀에도 축을 만들면 팀별로 여러 개 돌려주기
async function statTeamOf(ctx: Ctx, personId: string) {
  const axes: any[] = must(await ctx.db.from("stat_axes").select("team_id").eq("is_active", true)) ?? [];
  for (const t of [...new Set(axes.map((a) => a.team_id as string))]) {
    if ((await unitAudience(ctx, t)).some((p: any) => p.id === personId)) return t;
  }
  return null;
}
// 주는 사람 확인: 그 팀에서 기준 서열 이상 + 받는 사람이 그 팀 사람 + 본인 아님. 받는 사람·주는 사람 정보 반환
async function statGrantCheck(ctx: Ctx, teamId: string, personId: string, min: number) {
  if (!UUID_RE.test(String(teamId)) || !UUID_RE.test(String(personId))) throw new HttpError(400, "사람을 다시 골라주세요");
  if ((await rankIn(ctx, teamId)) < min) throw new HttpError(403, "권한이 없습니다");
  if (personId === ctx.me.id) throw new HttpError(400, "본인에게는 줄 수 없어요");
  const aud = await unitAudience(ctx, teamId);
  const target = aud.find((p: any) => p.id === personId);
  if (!target) throw new HttpError(403, "이 팀 사람에게만 줄 수 있어요");
  return { target, me: aud.find((p: any) => p.id === ctx.me.id) };
}
// { 축id: xp } → 행 목록. 활성 축만, 축당 1~3, 합계는 설정값까지
async function statItems(ctx: Ctx, teamId: string, items: any, maxXp: number) {
  if (!items || typeof items !== "object") throw new HttpError(400, "올려줄 스탯을 골라주세요");
  const axes: any[] = must(await ctx.db.from("stat_axes").select("id,name").eq("team_id", teamId).eq("is_active", true)) ?? [];
  const nameOf = new Map(axes.map((a) => [a.id, a.name]));
  const rows = Object.entries(items).filter(([, x]) => Number(x) > 0).map(([axis_id, x]) => {
    const xp = Number(x);
    if (!nameOf.has(axis_id) || !Number.isInteger(xp) || xp > 3) throw new HttpError(400, "스탯은 축마다 +1~+3이에요");
    return { axis_id, xp };
  });
  if (!rows.length) throw new HttpError(400, "올려줄 스탯을 하나 이상 골라주세요");
  if (rows.reduce((a, r) => a + r.xp, 0) > maxXp) throw new HttpError(400, `한 번에 ${maxXp} XP까지 줄 수 있어요`);
  return { rows, label: rows.slice().sort((a, b) => b.xp - a.xp).map((r) => `${nameOf.get(r.axis_id)} +${r.xp}`).join(", ") };
}
function statComment(v: any) {
  const c = String(v ?? "").trim().slice(0, 200);
  if (!c) throw new HttpError(400, "한 줄 코멘트를 적어주세요");
  return c;
}
// 녹음 회차 제목 (요청 제목 · 회차). 대본 내용은 없음 — 제목만
async function recSessionTitles(ctx: Ctx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows: any[] = must(await ctx.db.from("recording_sessions").select("id, title, recording_requests(title)").in("id", ids)) ?? [];
  return new Map(rows.map((r) => [r.id, [r.recording_requests?.title, r.title].filter(Boolean).join(" · ")]));
}

// 배지 판정 (DB 함수 award_badges, 몇 번 불러도 중복 없음) + 새로 딴 사람에게 봇 알림
async function awardBadges(ctx: Ctx, ids: string[], notify = true) {
  const got = new Map<string, any[]>();
  for (const id of [...new Set(ids)]) {
    const r = await ctx.db.rpc("award_badges", { p_person: id });
    if (r.error) { console.error("award_badges", r.error.message); continue; }
    if (r.data?.length) got.set(id, r.data);
  }
  if (notify && got.size) {
    for (const m of await withTelegram(ctx, [...got.keys()])) {
      const list = got.get(m.id)!.map((b: any) => `${b.out_icon} <b>${escHtml(b.out_name)}</b>`).join("\n");
      await sendToMembers([m], `🏅 <b>새 배지를 얻었어요!</b>\n${list}`, appButton("나의 기록 보기", "?go=profile"));
    }
  }
  return got;
}

// ----- 연말 결산 -----
// 관리자 명단(app_settings admins)에 있는지
async function isAdmin(ctx: Ctx) {
  const r = must(await ctx.db.from("app_settings").select("value").eq("key", "admins").maybeSingle());
  return Array.isArray(r?.value) && r.value.includes(ctx.me.id);
}
// 그해 공개일·공개 여부·미리보기 가능 여부
async function recapState(ctx: Ctx, year: number) {
  const rows: any[] = must(await ctx.db.from("app_settings").select("key,value").in("key", ["recap_open", "recap_enabled"])) ?? [];
  const v = new Map(rows.map((x) => [x.key, x.value]));
  const md = /^\d\d-\d\d$/.test(String(v.get("recap_open"))) ? String(v.get("recap_open")) : "12-22";
  const enabled = v.get("recap_enabled") === true;   // 관리자가 켜야 보임
  const admin = await isAdmin(ctx);
  const { teams } = await myTeams(ctx);
  // 꺼져 있으면 관리자만 미리보기
  const preview = admin || (enabled && teams.some((t: any) => t.rank >= RANK.INSTRUCTOR));
  return { year, open_md: md, enabled, open: enabled && Date.now() >= kstMs(`${year}-${md}`), preview, admin, teams };
}
// 장소 글자 → 동네지도 장소 이름 (places 별칭, 긴 것부터). 못 맞추면 null
async function placeNamer(ctx: Ctx) {
  const plc: any[] = must(await ctx.db.from("places").select("code, name, aliases").eq("is_active", true)) ?? [];
  const norm = (x: any) => String(x ?? "").toLowerCase().replace(/\s+/g, "");
  const list: [string, string][] = [];
  for (const p of plc) for (const a of [p.name, ...(p.aliases ?? [])]) if (norm(a)) list.push([norm(a), p.name]);
  list.sort((a, b) => b[0].length - a[0].length);
  return (loc: any) => { const n = norm(loc); if (!n) return null; for (const [a, nm] of list) if (n.includes(a)) return nm; return null; };
}
// 결산 기간: 기본 그해 1/1~12/31. from/to(YYYY-MM-DD)는 미리보기 가능한 사람만 (테스트용)
function recapRange(st: any, p: any) {
  if ((p.from || p.to) && st.preview) {
    if (!isDate(p.from) || !isDate(p.to) || p.from > p.to) throw new HttpError(400, "기간을 다시 골라주세요");
    return { from: kstMs(p.from), to: kstMs(addDaysStr(p.to, 1)), custom: true };
  }
  return { from: kstMs(`${st.year}-01-01`), to: kstMs(`${st.year + 1}-01-01`), custom: false };
}
function recapYear(p: any) {
  const y = Number(p?.year ?? kstToday().slice(0, 4));
  if (!Number.isInteger(y) || y < 2025 || y > 2100) throw new HttpError(400, "연도를 다시 골라주세요");
  return y;
}

// ----- 회비·후원 -----
// 설정값: treasurers(회계 명단), dues_monthly(한 달 회비), dues_start(받기 시작한 달), dues_nag_day(미납 알림 날)
async function duesSettings(ctx: Ctx) {
  const rows: any[] = must(await ctx.db.from("app_settings").select("key,value").in("key", ["treasurers", "dues_monthly", "dues_start", "dues_nag_day", "admins"])) ?? [];
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const arr = (x: any) => Array.isArray(x) ? x as string[] : [];
  return { treasurers: arr(v.get("treasurers")), admins: arr(v.get("admins")), monthly: Number(v.get("dues_monthly") ?? 10000),
    start: /^\d{4}-\d\d$/.test(String(v.get("dues_start"))) ? String(v.get("dues_start")) : kstToday().slice(0, 7), nagDay: Number(v.get("dues_nag_day") ?? 25) };
}
// 과원 = 과·과의 팀에 지금 직책이 있는 활성 인원
async function duesMembers(ctx: Ctx, teamId: string) {
  const units = await sectionUnits(ctx, teamId);
  return { sectionId: units[0], members: await unitMembers(ctx, units) };
}
function monthsBetween(a: string, b: string) {   // a~b 포함, 'YYYY-MM'
  const out: string[] = []; let [y, m] = a.split("-").map(Number);
  while (out.length < 120) { const k = `${y}-${String(m).padStart(2, "0")}`; if (k > b) break; out.push(k); if (++m > 12) { m = 1; y++; } }
  return out;
}
// 달마다 상태: 확인 / 대기 / 미납 (회비 줄의 months로 셈)
function duesMonthState(entries: any[], month: string) {
  const fee = entries.filter((e) => e.kind === "회비" && e.months.includes(month));
  return fee.some((e) => e.status === "확인") ? "확인" : fee.some((e) => e.status === "대기") ? "대기" : "미납";
}
// 매달 dues_nag_day(한국 시간 10시 이후)에 그달 미납 과원에게 한 번
async function cronDuesNag(ctx: Ctx) {
  const st = await duesSettings(ctx);
  const now = new Date(Date.now() + 9 * HOUR), month = now.toISOString().slice(0, 7);
  if (!st.nagDay || now.getUTCDate() < st.nagDay || now.getUTCHours() < 10 || month < st.start) return null;
  if (must(await ctx.db.from("dues_nags").select("month").eq("month", month).maybeSingle())) return null;
  const sections: any[] = must(await ctx.db.from("org_units").select("id").eq("unit_type", "과").is("ended_on", null)) ?? [];
  const members: any[] = [];
  for (const sec of sections) members.push(...await unitMembers(ctx, await sectionUnits(ctx, sec.id)));
  const ids = members.map((m) => m.id);
  const ent: any[] = ids.length ? must(await ctx.db.from("dues_entries").select("person_id, kind, months, status").eq("kind", "회비").in("person_id", ids).contains("months", [month])) ?? [] : [];
  const targets = members.filter((m) => duesMonthState(ent.filter((e) => e.person_id === m.id), month) === "미납");
  must(await ctx.db.from("dues_nags").insert({ month, result: { total: targets.length } }));   // 먼저 적어 두어 두 번 안 감
  const [y, mo] = month.split("-");
  const r = await sendToMembers(targets, `💰 <b>${Number(mo)}월 회비가 아직 확인되지 않았어요</b>\n\n입금하셨다면 미니앱 › 개인 › 회비에서 '납부 확인 요청'을 올려주세요.\n(이미 올리셨다면 회계담당자가 확인 중이에요)`,
    appButton("회비 화면 열기", "?go=dues"));
  must(await ctx.db.from("dues_nags").update({ result: { total: targets.length, sent: r.sent, failed: r.failed } }).eq("month", month));
  return { month, year: y, total: targets.length, sent: r.sent };
}

// ----- 동네지도 캐릭터 꾸미기 (people.town_look) -----
// 고를 수 있는 값은 여기 목록뿐 (화면도 이 목록으로 그림). 목록 밖 값은 저장 안 함
const LOOK_OPTS: Record<string, string[]> = {
  gender: ["m", "f"],
  skin: ["#f5d2b0", "#f2c9a0", "#e8b48a", "#d9a07a", "#b98463", "#8d5a3b"],
  style: ["short", "long", "bob", "bun", "up", "pony"],
  hair: ["#1d1d24", "#2b1d16", "#4a2f22", "#6b4426", "#8a5a3a", "#c9a26b", "#9aa0a6", "#b5533f"],
  shirt: ["#b56576", "#3d7ea6", "#4f772d", "#e9c46a", "#e07a5f", "#81b29a", "#6d597a", "#355070", "#c06c84", "#f2cc8f", "#6b8f71", "#b07d4f", "#7aa6e8", "#efe6d8", "#5a6270", "#8a6fa8"],
  bottom: ["pants", "skirt"],
  pants: ["#3a3a4a", "#4b3b2f", "#2f3e46", "#2f4858", "#6b3b36", "#d8d4cc", "#4f772d", "#b56576"],
  hat: ["", "cap", "helmet", "ribbon", "phones"],
  hatc: ["#2f4858", "#a24848", "#4f772d", "#355070", "#e8584a", "#e9c46a", "#f2f0ea", "#e07a8f"],
  ride: ["", "ford", "bike", "moto", "kick", "camel", "donkey", "turtle"],
};

// ----- 녹음 진행: 도착 · 시작 보고 · 종료 보고 -----
// 회차를 움직일 수 있는 사람 = 그 회차에 확정된 엔지니어 또는 과 안 교관 이상(녹음 관계자)
async function recCanRun(ctx: Ctx, s: any) {
  if ((s.recording_participants ?? []).some((x: any) => x.person_id === ctx.me.id && x.role === "엔지니어" && x.selected)) return true;
  try { await recSection(ctx, s.team_id); return true; } catch { return false; }
}
// 도착을 누를 수 있는 때: 확정된 회차, 시작 2시간 전 ~ 끝날 때까지(종료 보고 전)
function recArriveOpen(s: any) {
  const st = Date.parse(s.scheduled_start), en = s.scheduled_end ? Date.parse(s.scheduled_end) : st + 3 * HOUR, now = Date.now();
  return s.status === "예정" && !s.ended_at && now >= st - 2 * HOUR && now <= en + HOUR;
}
async function recMarkArrived(ctx: Ctx, s: any, pt: any) {
  if (pt.arrived_at) return false;
  must(await ctx.db.from("recording_participants").update({ arrived_at: new Date().toISOString(), arrived_by: ctx.me.id }).eq("id", pt.id));
  // 엔지니어(본인 빼고)에게 알림
  const eng = (s.recording_participants ?? []).filter((x: any) => x.role === "엔지니어" && x.selected && x.person_id !== ctx.me.id).map((x: any) => x.person_id);
  const who = (await nameMap(ctx, [pt.person_id])).get(pt.person_id) ?? "";
  if (eng.length) await sendToMembers(await withTelegram(ctx, eng), `🎙 <b>${escHtml(who)}</b>님이 녹음실에 도착했어요${s.title ? ` (${escHtml(s.title)})` : ""}`);
  return true;
}
// 오늘 도착할 수 있는 내 녹음 (봇 '도착'에서 씀)
async function myArrivable(ctx: Ctx) {
  const rows: any[] = must(await ctx.db.from("recording_participants").select("id, session_id").eq("person_id", ctx.me.id).eq("selected", true).is("arrived_at", null)) ?? [];
  const out = [];
  for (const r of rows) { const s = await recSessionFull(ctx, r.session_id); if (recArriveOpen(s)) out.push({ s, pt: s.recording_participants.find((x: any) => x.id === r.id) }); }
  return out;
}

// ----- 첨부 대본 (공지·과제) -----
// 우리 교회 대본이 아닐 때만 (교회 대본은 NAS). 비공개 보관함 'scripts', 받는 사람만 잠깐(5분) 열리는 주소, 기간 지나면 cron이 지움
const FILE_EXT = ["pdf", "hwp", "hwpx", "doc", "docx", "txt", "rtf"];
const FILE_MAX = 20 * 1024 * 1024;
// 올리거나 지울 수 있는 사람 = 그 글을 쓴 사람, 또는 공지 관리(팀 교관·과 팀장 이상)·과제 교관 이상
async function fileCanEdit(ctx: Ctx, kind: string, id: string) {
  const t = await readTarget(ctx, kind, id);
  if (t.by === ctx.me.id) return t;
  if (kind === "assignment" ? t.rank >= RANK.INSTRUCTOR : t.canSee) return t;   // 공지: 관리자, 모임: 조장 이상
  throw new HttpError(403, "글을 쓴 사람이나 관리하는 사람만 올릴 수 있어요");
}
// 열 수 있는 사람 = 쓴 사람·관리하는 사람·받는 사람
async function fileCanOpen(ctx: Ctx, kind: string, id: string) {
  const t = await readTarget(ctx, kind, id);
  if (t.by === ctx.me.id || t.canSee || t.inTarget) return;
  if ((await t.audience()).some((m: any) => m.id === ctx.me.id)) return;
  throw new HttpError(403, "받는 사람만 열 수 있어요");
}
async function cronFiles(ctx: Ctx) {
  const old: any[] = must(await ctx.db.from("content_files").select("id, path").is("deleted_at", null).lt("expires_at", new Date().toISOString()).limit(100)) ?? [];
  // 올리다 만 것(1일 지난 미완료)도 정리
  const stale: any[] = must(await ctx.db.from("content_files").select("id, path").is("deleted_at", null).eq("uploaded", false).lt("created_at", new Date(Date.now() - 24 * HOUR).toISOString()).limit(100)) ?? [];
  const all = [...old, ...stale];
  if (!all.length) return null;
  await ctx.db.storage.from("scripts").remove(all.map((f) => f.path));
  must(await ctx.db.from("content_files").update({ deleted_at: new Date().toISOString() }).in("id", all.map((f) => f.id)));
  return { deleted: all.length };
}

// ----- 장소 신청 -----
// 승인자: 설정값 place_approvers {recording, external}. 비면 녹음실 = 엔지니어팀 팀장 이상, 외부(총회·성전) = 과 부과장 이상
async function placeApprovers(ctx: Ctx, kind: string, sectionId: string) {
  const r = must(await ctx.db.from("app_settings").select("value").eq("key", "place_approvers").maybeSingle());
  const list: string[] = Array.isArray(r?.value?.[kind]) ? r.value[kind] : [];
  if (list.length) return list;
  if (kind === "recording") {
    const eng = must(await ctx.db.from("org_units").select("id").eq("parent_id", sectionId).eq("name", "엔지니어팀").maybeSingle());
    return eng ? (await unitAudience(ctx, eng.id)).filter((m: any) => m.rank >= RANK.TEAM_LEADER).map((m: any) => m.id) : [];
  }
  return (await unitAudience(ctx, sectionId)).filter((m: any) => m.rank >= 50).map((m: any) => m.id);
}
const PLACE_KIND: Record<string, string> = { recording: "녹음실 (엔지니어팀장 승인)", external: "다른 부서도 쓰는 곳 (과장·부과장 승인)", none: "먼저 신청한 사람이 써요" };

// ----- 인원 특이사항 -----
const NOTE_CAT = ["건강", "직장·학업", "일정 충돌", "가정", "기타"], NOTE_AFFECT = ["수업", "스터디", "녹음", "업무"];
async function noteStaff(ctx: Ctx, teamId: string) {
  if (!UUID_RE.test(String(teamId))) throw new HttpError(400, "팀을 다시 골라주세요");
  if ((await rankIn(ctx, teamId)) < RANK.INSTRUCTOR) throw new HttpError(403, "인원 특이사항은 그 팀 교관 이상만 볼 수 있어요");
}
// 팀원 = 그 팀(과 상속 포함) 직책이 있는 활성 인원
async function noteMembers(ctx: Ctx, teamId: string) { return await unitAudience(ctx, teamId); }
function noteFields(p: any, staff: boolean) {
  const t = (v: any, n: number) => String(v ?? "").trim().slice(0, n);
  const row: any = {};
  if (!NOTE_CAT.includes(p.category)) throw new HttpError(400, "종류를 골라주세요");
  row.category = p.category;
  row.title = t(p.title, 60); if (!row.title) throw new HttpError(400, "한 줄 요약을 적어주세요");
  row.body = t(p.body, 1000) || null;
  if (!isDate(p.starts_on)) throw new HttpError(400, "언제부터인지 골라주세요");
  row.starts_on = p.starts_on; row.ends_on = isDate(p.ends_on) ? p.ends_on : null;
  if (row.ends_on && row.ends_on < row.starts_on) throw new HttpError(400, "끝나는 날이 시작보다 빨라요");
  row.affects = (Array.isArray(p.affects) ? p.affects : []).filter((x: any) => NOTE_AFFECT.includes(x));
  if (staff) {
    if (p.status !== undefined) { if (!["진행 중", "해결됨"].includes(p.status)) throw new HttpError(400, "상태가 올바르지 않아요"); row.status = p.status; }
    if (p.followup !== undefined) { if (!["없음", "보강", "대체학습"].includes(p.followup)) throw new HttpError(400, "후속 조치가 올바르지 않아요"); row.followup = p.followup; }
  }
  return row;
}

// ----- 회의 모드 -----
// 볼 수 있는 사람 = 그 모임 대상자 + 그 팀 교관 이상. 진행자 = 모임 만든 사람(화면 넘기기·시간 늘리기·시작·끝), 서기 = 진행자가 지정(요약·결정·할 일 칸)
async function mtgLoad(ctx: Ctx, meetingId: string) {
  const m = must(await ctx.db.from("meetings").select("*").eq("id", meetingId).maybeSingle());
  if (!m) throw new HttpError(404, "회의를 찾을 수 없어요");
  return m;
}
async function mtgAccess(ctx: Ctx, m: any) {
  const s = must(await ctx.db.from("meeting_sessions").select("*, meeting_types(name)").eq("id", m.session_id).single());
  const members = await sessionMembers(ctx, s);
  const staff = (await rankIn(ctx, m.team_id)) >= RANK.INSTRUCTOR;
  if (!staff && !members.some((x: any) => x.id === ctx.me.id) && m.chair_id !== ctx.me.id) throw new HttpError(403, "이 회의 참석자만 볼 수 있어요");
  return { s, members, chair: m.chair_id === ctx.me.id, scribe: m.scribe_id === ctx.me.id };
}
const mtgChair = (a: any) => { if (!a.chair) throw new HttpError(403, "진행자만 할 수 있어요"); };
const mtgWriter = (a: any) => { if (!a.chair && !a.scribe) throw new HttpError(403, "진행자나 서기만 쓸 수 있어요"); };
async function cronMeetings(ctx: Ctx) {
  const now = new Date(Date.now() + 9 * HOUR), hour = now.getUTCHours(), tomorrow = addDaysStr(kstToday(), 1);
  let prep = 0, d1 = 0, over = 0;
  // 회의 전날 18시 뒤: 의견을 안 남긴 참석자에게 한 번
  if (hour >= 18) {
    const ms: any[] = must(await ctx.db.from("meetings").select("id, session_id, meeting_sessions!inner(session_date, title, meeting_types(name))").eq("status", "준비").is("prep_reminded_at", null).eq("meeting_sessions.session_date", tomorrow)) ?? [];
    for (const m of ms) {
      must(await ctx.db.from("meetings").update({ prep_reminded_at: new Date().toISOString() }).eq("id", m.id));
      const items: any[] = must(await ctx.db.from("meeting_items").select("id").eq("meeting_id", m.id).neq("kind", "할 일 점검")) ?? [];
      if (!items.length) continue;
      const ops: any[] = must(await ctx.db.from("meeting_opinions").select("person_id, item_id").in("item_id", items.map((i) => i.id))) ?? [];
      const s = must(await ctx.db.from("meeting_sessions").select("*").eq("id", m.session_id).single());
      const lazy = (await sessionMembers(ctx, s, true)).filter((x: any) => ops.filter((o) => o.person_id === x.id).length < items.length);
      const r = await sendToMembers(lazy, `🗂 <b>내일 회의 안건에 의견을 남겨주세요</b>\n${escHtml(m.meeting_sessions.title || m.meeting_sessions.meeting_types?.name || "회의")} · 안건 ${items.length}개\n한두 줄이면 돼요. 회의가 훨씬 빨라져요`, appButton("안건 보기", "?go=attend"));
      prep += r.sent;
    }
  }
  // 할 일: 마감 하루 전 · 마감 지남 (밤 0~8시 제외)
  if (hour >= 8) {
    const acts: any[] = must(await ctx.db.from("meeting_actions").select("id, assignee_id, task, due_on, reminded_d1_at, reminded_over_at").is("done_at", null).not("due_on", "is", null).lte("due_on", tomorrow)) ?? [];
    for (const a of acts) {
      const late = a.due_on < kstToday();
      if (late ? a.reminded_over_at : a.reminded_d1_at) continue;
      must(await ctx.db.from("meeting_actions").update(late ? { reminded_over_at: new Date().toISOString() } : { reminded_d1_at: new Date().toISOString() }).eq("id", a.id));
      const r = await sendToMembers(await withTelegram(ctx, [a.assignee_id]), `${late ? "⏰ <b>회의에서 맡은 일 마감이 지났어요</b>" : "📌 <b>회의에서 맡은 일, 마감이 다가와요</b>"}\n${escHtml(a.task)} · ${a.due_on.slice(5).replace("-", "/")}까지`, appButton("할 일 보기", "?go=profile"));
      if (late) over += r.sent; else d1 += r.sent;
    }
  }
  return prep || d1 || over ? { prep, d1, over } : null;
}

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
      is_admin: await isAdmin(ctx),
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

  // ----- 성우 스탯 -----
  // 스탯 보기 { person_id? }: 본인 것은 누구나, 다른 사람 것은 그 팀에서 기준 서열(교관) 이상만
  async "stats.get"(ctx) {
    const pid = ctx.payload?.person_id || ctx.me.id;
    if (!UUID_RE.test(String(pid))) throw new HttpError(400, "사람을 다시 골라주세요");
    const st = await statSettings(ctx);
    const team = await statTeamOf(ctx, pid);
    if (pid !== ctx.me.id && (!team || (await rankIn(ctx, team)) < st.min)) throw new HttpError(403, "권한이 없습니다");
    if (!team) return { team_id: null };
    const [axes, totals, grants] = await Promise.all([
      ctx.db.from("stat_axes").select("id,key,name,description").eq("team_id", team).eq("is_active", true).order("sort").then(must),
      ctx.db.from("v_stat_xp").select("axis_id,xp").eq("person_id", pid).then(must),
      ctx.db.from("stat_grants").select("id,granted_by,source_type,source_id,comment,created_at,people!stat_grants_granted_by_fkey(name),stat_grant_items(axis_id,xp)")
        .eq("person_id", pid).eq("team_id", team).is("revoked_at", null).order("created_at", { ascending: false }).then(must),
    ]);
    // 지난달 모양 = 이번 달 1일(한국 시간) 전까지 받은 XP
    const monthStart = Date.parse(kstToday().slice(0, 8) + "01T00:00:00+09:00");
    const now = new Map<string, number>((totals ?? []).map((t: any) => [t.axis_id, t.xp]));
    const prev = new Map<string, number>();
    for (const g of grants ?? []) {
      if (Date.parse(g.created_at) >= monthStart) continue;
      for (const i of g.stat_grant_items) prev.set(i.axis_id, (prev.get(i.axis_id) ?? 0) + i.xp);
    }
    const titles = await recSessionTitles(ctx, (grants ?? []).filter((g: any) => g.source_type === "녹음" && g.source_id).map((g: any) => g.source_id));
    const axisName = new Map((axes ?? []).map((a: any) => [a.id, a.name]));
    return {
      team_id: team, max_level: st.maxLevel,
      axes: (axes ?? []).map((a: any) => {
        const xp = now.get(a.id) ?? 0, pxp = prev.get(a.id) ?? 0;
        return { id: a.id, key: a.key, name: a.name, description: a.description, xp, ...statLevel(xp, st.factor, st.maxLevel), prev_level: statLevel(pxp, st.factor, st.maxLevel).level, prev_xp: pxp };
      }),
      feedback: (grants ?? []).map((g: any) => ({
        id: g.id, at: g.created_at, source_type: g.source_type, title: g.source_id ? titles.get(g.source_id) ?? null : null,
        by: g.people?.name ?? "", comment: g.comment,
        items: g.stat_grant_items.map((i: any) => ({ name: axisName.get(i.axis_id) ?? "", xp: i.xp })).filter((i: any) => i.name),
      })),
    };
  },
  // 스탯 주기 팝업에 필요한 것: 내가 줄 수 있는 팀(축·사람). { person_id, source_id } 가 있으면 그 실무에서 내가 이미 준 것
  async "stats.form"(ctx) {
    const st = await statSettings(ctx);
    const axes: any[] = must(await ctx.db.from("stat_axes").select("id,team_id,name").eq("is_active", true).order("sort")) ?? [];
    const teams = [];
    for (const t of [...new Set(axes.map((a) => a.team_id as string))]) {
      if ((await rankIn(ctx, t)) < st.min) continue;
      const aud = await unitAudience(ctx, t);
      teams.push({
        team_id: t, axes: axes.filter((a) => a.team_id === t).map((a) => ({ id: a.id, name: a.name })),
        people: aud.filter((p: any) => p.id !== ctx.me.id).map((p: any) => ({ id: p.id, name: p.name, position: p.position })),
      });
    }
    let existing = null;
    const { person_id, source_id } = ctx.payload ?? {};
    if (UUID_RE.test(String(person_id)) && UUID_RE.test(String(source_id))) {
      const g = must(await ctx.db.from("stat_grants").select("id,comment,stat_grant_items(axis_id,xp)")
        .eq("granted_by", ctx.me.id).eq("person_id", person_id).eq("source_id", source_id).is("revoked_at", null).maybeSingle());
      if (g) existing = { id: g.id, comment: g.comment, items: Object.fromEntries(g.stat_grant_items.map((i: any) => [i.axis_id, i.xp])) };
    }
    return { max_xp: st.maxXp, teams, existing };
  },
  // 스탯 주기 { team_id, person_id, source_type, source_id?, items: {축id: 1~3}, comment }
  // 녹음이면 완료된 회차 + 그 회차에 들어간 사람만. 같은 실무에서 같은 사람에게 1번만 (그다음은 고치기)
  async "stats.grant"(ctx) {
    const p = ctx.payload ?? {};
    const st = await statSettings(ctx);
    const { target, me } = await statGrantCheck(ctx, p.team_id, p.person_id, st.min);
    if (!STAT_SOURCES.includes(p.source_type)) throw new HttpError(400, "어떤 실무인지 골라주세요");
    let sourceId: string | null = null, title = "";
    if (p.source_type === "녹음") {
      if (!UUID_RE.test(String(p.source_id))) throw new HttpError(400, "녹음 회차를 다시 골라주세요");
      const s = must(await ctx.db.from("recording_sessions").select("id,status").eq("id", p.source_id).maybeSingle());
      if (!s || s.status !== "완료") throw new HttpError(400, "녹음을 마친 회차에만 줄 수 있어요");
      const part: any[] = must(await ctx.db.from("recording_participants").select("id").eq("session_id", s.id).eq("person_id", target.id).eq("selected", true).limit(1)) ?? [];
      if (!part.length) throw new HttpError(400, "이 회차에 들어간 사람이 아니에요");
      sourceId = s.id;
      title = (await recSessionTitles(ctx, [s.id])).get(s.id) ?? "";
    }
    const comment = statComment(p.comment);
    const { rows, label } = await statItems(ctx, p.team_id, p.items, st.maxXp);
    await rateLimit(ctx, "stat_grant", 60, 60);
    const ins = await ctx.db.from("stat_grants").insert({
      team_id: p.team_id, person_id: target.id, granted_by: ctx.me.id, source_type: p.source_type, source_id: sourceId, comment,
    }).select("id").single();
    if (ins.error?.code === "23505") throw new HttpError(409, "이 실무에서 이미 스탯을 줬어요. 고치기로 바꿔주세요");
    const g = must(ins);
    const it = await ctx.db.from("stat_grant_items").insert(rows.map((r) => ({ grant_id: g.id, ...r })));
    if (it.error) { await ctx.db.from("stat_grants").delete().eq("id", g.id); throw it.error; }
    const person = must(await ctx.db.from("people").select("name, telegram_user_id").eq("id", target.id).single());
    const who = `${ctx.me.name}${me?.position ? " " + me.position : ""}님`;
    const notify = await sendToMembers([person],
      `⭐ <b>${escHtml(who)}이 스탯을 올려줬어요</b>\n${escHtml(label)}${title ? `\n🎙 ${escHtml(title)}` : ` (${p.source_type})`}\n“${escHtml(comment)}”`,
      appButton("나의 기록 보기", "?go=profile"));
    await awardBadges(ctx, [target.id]);
    return { id: g.id, notify };
  },
  // 스탯 고치기 { id, items, comment }: 준 사람 본인만 (지금도 기준 서열 이상일 때)
  async "stats.update"(ctx) {
    const p = ctx.payload ?? {};
    if (!UUID_RE.test(String(p.id))) throw new HttpError(400, "다시 골라주세요");
    const st = await statSettings(ctx);
    const g = must(await ctx.db.from("stat_grants").select("id,team_id,granted_by,revoked_at").eq("id", p.id).maybeSingle());
    if (!g || g.revoked_at) throw new HttpError(404, "없거나 취소된 기록이에요");
    if (g.granted_by !== ctx.me.id) throw new HttpError(403, "준 사람만 고칠 수 있어요");
    await requireRank(ctx, g.team_id, st.min);
    const comment = statComment(p.comment);
    const { rows } = await statItems(ctx, g.team_id, p.items, st.maxXp);
    must(await ctx.db.from("stat_grant_items").delete().eq("grant_id", g.id));
    must(await ctx.db.from("stat_grant_items").insert(rows.map((r) => ({ grant_id: g.id, ...r }))));
    must(await ctx.db.from("stat_grants").update({ comment }).eq("id", g.id));
    return { id: g.id };
  },
  // 지급 취소 { id }: 준 사람 본인 또는 그 팀 팀장 이상. 지우지 않고 취소 표시(이력에 남음)
  async "stats.revoke"(ctx) {
    const p = ctx.payload ?? {};
    if (!UUID_RE.test(String(p.id))) throw new HttpError(400, "다시 골라주세요");
    const g = must(await ctx.db.from("stat_grants").select("id,team_id,granted_by,revoked_at").eq("id", p.id).maybeSingle());
    if (!g || g.revoked_at) throw new HttpError(404, "없거나 이미 취소된 기록이에요");
    if (g.granted_by !== ctx.me.id) await requireRank(ctx, g.team_id, RANK.TEAM_LEADER);
    must(await ctx.db.from("stat_grants").update({ revoked_at: new Date().toISOString(), revoked_by: ctx.me.id }).eq("id", g.id));
    return { ok: true };
  },

  // ----- 칭호·배지 -----
  // 배지 보기 { person_id? }: 본인, 또는 그 팀 교관(stat_grant_min_level) 이상. 본인이면 먼저 판정(놓친 것 챙김)
  async "badges.get"(ctx) {
    const pid = ctx.payload?.person_id || ctx.me.id;
    if (!UUID_RE.test(String(pid))) throw new HttpError(400, "사람을 다시 골라주세요");
    const all: any[] = must(await ctx.db.from("badges").select("id,team_id,name,description,icon,sort").eq("is_active", true).order("sort")) ?? [];
    const teams = [...new Set(all.map((b) => b.team_id as string))];
    const mine: string[] = [];
    for (const t of teams) if ((await unitAudience(ctx, t)).some((p: any) => p.id === pid)) mine.push(t);
    if (pid !== ctx.me.id) {
      const st = await statSettings(ctx);
      let ok = false;
      for (const t of mine) if ((await rankIn(ctx, t)) >= st.min) ok = true;
      if (!ok) throw new HttpError(403, "권한이 없습니다");
    } else await awardBadges(ctx, [pid]);
    const have: any[] = must(await ctx.db.from("person_badges").select("badge_id,earned_at,is_title").eq("person_id", pid)) ?? [];
    const by = new Map(have.map((h) => [h.badge_id, h]));
    return {
      badges: all.filter((b) => mine.includes(b.team_id)).map((b) => {
        const h = by.get(b.id);
        return { id: b.id, name: b.name, description: b.description, icon: b.icon, earned_at: h?.earned_at ?? null, is_title: !!h?.is_title };
      }),
    };
  },
  // 대표 칭호 고르기 { badge_id | null }: 내가 딴 배지 중 하나, null이면 안 보이게
  async "badges.setTitle"(ctx) {
    const bid = ctx.payload?.badge_id ?? null;
    if (bid !== null && !UUID_RE.test(String(bid))) throw new HttpError(400, "배지를 다시 골라주세요");
    if (bid) {
      const h = must(await ctx.db.from("person_badges").select("id").eq("person_id", ctx.me.id).eq("badge_id", bid).maybeSingle());
      if (!h) throw new HttpError(400, "얻은 배지만 대표 칭호로 고를 수 있어요");
    }
    must(await ctx.db.from("person_badges").update({ is_title: false }).eq("person_id", ctx.me.id).eq("is_title", true));
    if (bid) must(await ctx.db.from("person_badges").update({ is_title: true }).eq("person_id", ctx.me.id).eq("badge_id", bid));
    return { ok: true };
  },

  // ----- 연말 결산 -----
  // 결산 상태 { year? } → 공개일·공개 여부·미리보기·관리자
  async "recap.status"(ctx) {
    const st = await recapState(ctx, recapYear(ctx.payload));
    return { year: st.year, open_md: st.open_md, enabled: st.enabled, open: st.open, preview: st.preview, admin: st.admin };
  },
  // 리포트 켜기·끄기 { on } — 관리자 명단만
  async "recap.setEnabled"(ctx) {
    if (!(await isAdmin(ctx))) throw new HttpError(403, "관리자만 바꿀 수 있어요");
    const on = ctx.payload?.on === true;
    must(await ctx.db.from("app_settings").upsert({ key: "recap_enabled", value: on, description: "연말 결산 리포트 켜기 (관리자가 켜야 보임)", updated_by: ctx.me.id, updated_at: new Date().toISOString() }));
    return { enabled: on };
  },
  // 공개일 바꾸기 { md: "MM-DD" } — 관리자 명단만
  async "recap.setOpen"(ctx) {
    if (!(await isAdmin(ctx))) throw new HttpError(403, "관리자만 바꿀 수 있어요");
    const md = String(ctx.payload?.md ?? "");
    const m = md.match(/^(\d\d)-(\d\d)$/);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) throw new HttpError(400, "날짜를 다시 골라주세요");
    must(await ctx.db.from("app_settings").update({ value: md, updated_by: ctx.me.id, updated_at: new Date().toISOString() }).eq("key", "recap_open"));
    return { open_md: md };
  },
  // 내 결산 { year?, from?, to? }: 본인 것만 (다른 사람 id는 받지 않음). 공개 전엔 미리보기 가능한 사람만
  // summary(공유 이미지용)엔 숫자·스탯 모양·배지 아이콘만 — 제목·코드·배역·코멘트·이름은 넣지 않음
  async "recap.get"(ctx) {
    const st = await recapState(ctx, recapYear(ctx.payload));
    if (!st.open && !st.preview) throw new HttpError(403, "아직 열리지 않았어요");
    const { from, to, custom } = recapRange(st, ctx.payload ?? {});
    const iso = [new Date(from).toISOString(), new Date(to).toISOString()];
    const day = [new Date(from + 9 * HOUR).toISOString().slice(0, 10), new Date(to + 9 * HOUR).toISOString().slice(0, 10)];
    const me = ctx.me.id, nameOf = await placeNamer(ctx);

    // 1) 녹음: 완료된 회차에 성우로 확정돼 들어간 것
    const myRec: any[] = must(await ctx.db.from("recording_participants")
      .select("session_id, role_id, recording_sessions!inner(id, status, scheduled_start, location)")
      .eq("person_id", me).eq("role", "녹음자").eq("selected", true)
      .eq("recording_sessions.status", "완료").gte("recording_sessions.scheduled_start", iso[0]).lt("recording_sessions.scheduled_start", iso[1])) ?? [];
    const recIds = [...new Set(myRec.map((r) => r.session_id as string))];
    const roles = new Set(myRec.map((r) => r.role_id).filter(Boolean)).size;
    // 6) 함께 녹음한 사람 (성우·엔지니어 각각 가장 많이)
    const co: any[] = recIds.length ? must(await ctx.db.from("recording_participants").select("session_id, person_id, role, people(name)")
      .in("session_id", recIds).eq("selected", true).neq("person_id", me)) ?? [] : [];
    const top = (role: string) => {
      const c = new Map<string, { name: string; n: number; s: Set<string> }>();
      for (const r of co.filter((x) => x.role === role)) { const v = c.get(r.person_id) ?? { name: r.people?.name ?? "", n: 0, s: new Set() }; if (!v.s.has(r.session_id)) { v.s.add(r.session_id); v.n++; } c.set(r.person_id, v); }
      const b = [...c.values()].sort((a, z) => z.n - a.n)[0];
      return b ? { name: b.name, count: b.n } : null;
    };
    // 7) 참석한 모임 (마감된 모임에서 참석·지각·조퇴)
    const attAll: any[] = must(await ctx.db.from("attendance").select("session_id, status, meeting_sessions!inner(session_date, closed_at, location, meeting_types(default_location))")
      .eq("person_id", me).in("status", ["참석", "지각", "조퇴", "불참"]).not("meeting_sessions.closed_at", "is", null)
      .gte("meeting_sessions.session_date", day[0]).lt("meeting_sessions.session_date", day[1])) ?? [];
    const att = attAll.filter((a) => a.status !== "불참");
    // 지각·결석 수는 본인 화면에만 (summary·공유 이미지엔 안 넣음)
    const late = attAll.filter((a) => a.status === "지각").length, absent = attAll.filter((a) => a.status === "불참").length;
    // 2) 제일 많이 간 장소 (모임 + 녹음)
    const pc = new Map<string, number>();
    for (const a of att) { const n = nameOf(a.meeting_sessions?.location || a.meeting_sessions?.meeting_types?.default_location); if (n) pc.set(n, (pc.get(n) ?? 0) + 1); }
    for (const id of recIds) { const r = myRec.find((x) => x.session_id === id); const n = nameOf(r?.recording_sessions?.location); if (n) pc.set(n, (pc.get(n) ?? 0) + 1); }
    const topPlace = [...pc.entries()].sort((a, b) => b[1] - a[1])[0];
    // 3) 스탯: 기간 시작 vs 끝
    const sst = await statSettings(ctx), team = await statTeamOf(ctx, me);
    let stats = null;
    if (team) {
      const axes: any[] = must(await ctx.db.from("stat_axes").select("id,name").eq("team_id", team).eq("is_active", true).order("sort")) ?? [];
      const gs: any[] = must(await ctx.db.from("stat_grants").select("created_at, stat_grant_items(axis_id, xp)").eq("person_id", me).eq("team_id", team).is("revoked_at", null).lt("created_at", iso[1])) ?? [];
      const a0 = new Map<string, number>(), a1 = new Map<string, number>();
      for (const g of gs) for (const i of g.stat_grant_items) { a1.set(i.axis_id, (a1.get(i.axis_id) ?? 0) + i.xp); if (Date.parse(g.created_at) < from) a0.set(i.axis_id, (a0.get(i.axis_id) ?? 0) + i.xp); }
      const ax = axes.map((a) => ({ name: a.name, start: statLevel(a0.get(a.id) ?? 0, sst.factor, sst.maxLevel).level, now: statLevel(a1.get(a.id) ?? 0, sst.factor, sst.maxLevel).level, gain: (a1.get(a.id) ?? 0) - (a0.get(a.id) ?? 0) }));
      const best = ax.slice().sort((a, b) => b.gain - a.gain)[0];
      stats = { max_level: sst.maxLevel, axes: ax, best: best && best.gain > 0 ? best.name : null };
    }
    // 4) 교관 코멘트: 받은 XP가 큰 지급 3개
    const cg: any[] = must(await ctx.db.from("stat_grants").select("comment, created_at, people!stat_grants_granted_by_fkey(name), stat_grant_items(xp)")
      .eq("person_id", me).is("revoked_at", null).gte("created_at", iso[0]).lt("created_at", iso[1])) ?? [];
    const comments = cg.map((g) => ({ comment: g.comment, by: g.people?.name ?? "", at: g.created_at, xp: g.stat_grant_items.reduce((a: number, i: any) => a + i.xp, 0) }))
      .sort((a, b) => b.xp - a.xp || Date.parse(b.at) - Date.parse(a.at)).slice(0, 3);
    // 5) 기간 안에 딴 배지
    const bd: any[] = must(await ctx.db.from("person_badges").select("earned_at, badges(name, icon)").eq("person_id", me).gte("earned_at", iso[0]).lt("earned_at", iso[1]).order("earned_at")) ?? [];
    const badges = bd.filter((b) => b.badges).map((b) => ({ name: b.badges.name, icon: b.badges.icon }));

    return {
      year: st.year, open: st.open, custom, from: day[0], to: addDaysStr(day[1], -1),
      recordings: recIds.length, roles, place: topPlace ? { name: topPlace[0], count: topPlace[1] } : null,
      stats, comments, badges, with_voice: top("녹음자"), with_engineer: top("엔지니어"), meetings: att.length, late, absent,
      summary: {
        year: st.year, recordings: recIds.length, roles, meetings: att.length, badges: badges.map((b) => b.icon),
        stats: stats ? { max_level: stats.max_level, levels: stats.axes.map((a: any) => a.now), labels: stats.axes.map((a: any) => a.name) } : null,
      },
    };
  },
  // 팀 결산 { team_id, year?, from?, to? }: 그 팀 교관 이상. 팀 합계만 (개인별 없음)
  async "recap.team"(ctx) {
    const p = ctx.payload ?? {};
    await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    const st = await recapState(ctx, recapYear(p));
    if (!st.open && !st.preview) throw new HttpError(403, "아직 열리지 않았어요");
    const { from, to } = recapRange(st, p);
    const iso = [new Date(from).toISOString(), new Date(to).toISOString()];
    const day = [new Date(from + 9 * HOUR).toISOString().slice(0, 10), new Date(to + 9 * HOUR).toISOString().slice(0, 10)];
    const cnt = async (q: any) => (await q).count ?? 0;
    const sess: any[] = must(await ctx.db.from("meeting_sessions").select("id").eq("team_id", p.team_id).not("closed_at", "is", null).gte("session_date", day[0]).lt("session_date", day[1])) ?? [];
    const [rec, attend, grants, badges] = await Promise.all([
      cnt(ctx.db.from("recording_sessions").select("id", { count: "exact", head: true }).eq("team_id", p.team_id).eq("status", "완료").gte("scheduled_start", iso[0]).lt("scheduled_start", iso[1])),
      sess.length ? cnt(ctx.db.from("attendance").select("session_id", { count: "exact", head: true }).in("session_id", sess.map((x) => x.id)).in("status", ["참석", "지각", "조퇴"])) : 0,
      cnt(ctx.db.from("stat_grants").select("id", { count: "exact", head: true }).eq("team_id", p.team_id).is("revoked_at", null).gte("created_at", iso[0]).lt("created_at", iso[1])),
      cnt(ctx.db.from("person_badges").select("id, badges!inner(team_id)", { count: "exact", head: true }).eq("badges.team_id", p.team_id).gte("earned_at", iso[0]).lt("earned_at", iso[1])),
    ]);
    return { recordings: rec, meetings: sess.length, attendance: attend, grants, badges };
  },

  // ----- 회비·후원 -----
  // 내 회비 { team_id } → 달마다 상태(받기 시작한 달 ~ 이번 달), 내가 올린 것, 회계·관리자인지 (관리자면 과원 명단·회계 명단도)
  async "dues.mine"(ctx) {
    const st = await duesSettings(ctx);
    const { members } = await duesMembers(ctx, ctx.payload?.team_id);
    if (!members.some((m) => m.id === ctx.me.id)) throw new HttpError(403, "과원만 볼 수 있어요");
    const ent: any[] = must(await ctx.db.from("dues_entries").select("id, kind, months, amount, depositor, item, qty, memo, status, reject_reason, created_at, reviewed_at")
      .eq("person_id", ctx.me.id).neq("status", "취소").order("created_at", { ascending: false })) ?? [];
    const cur = kstToday().slice(0, 7);
    const admin = st.admins.includes(ctx.me.id);
    return {
      monthly: st.monthly, start: st.start, current: cur,
      months: monthsBetween(st.start, cur).reverse().map((m) => ({ month: m, state: duesMonthState(ent, m) })),
      entries: ent, treasurer: st.treasurers.includes(ctx.me.id), admin,
      ...(admin ? { people: members.map((m) => ({ id: m.id, name: m.name })), treasurers: st.treasurers } : {}),
    };
  },
  // 확인 요청 올리기 { team_id, kind: 회비|물품, months?, amount?, depositor?, item?, qty?, memo? } → 회계담당자에게 알림
  async "dues.submit"(ctx) {
    const p = ctx.payload ?? {};
    const st = await duesSettings(ctx);
    const { sectionId, members } = await duesMembers(ctx, p.team_id);
    if (!members.some((m) => m.id === ctx.me.id)) throw new HttpError(403, "과원만 올릴 수 있어요");
    const t = (v: any, n: number) => String(v ?? "").trim().slice(0, n) || null;
    const row: any = { section_id: sectionId, person_id: ctx.me.id, kind: p.kind, memo: t(p.memo, 300) };
    let label = "";
    if (p.kind === "회비") {
      const cur = kstToday().slice(0, 7), ok = monthsBetween(st.start, addDaysStr(cur + "-01", 370).slice(0, 7));
      const months = [...new Set((Array.isArray(p.months) ? p.months : []).map(String))].sort() as string[];
      if (!months.length || months.length > 12 || months.some((m) => !ok.includes(m))) throw new HttpError(400, "몇 월 회비인지 골라주세요");
      const amount = Number(p.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) throw new HttpError(400, "입금한 금액을 숫자로 적어주세요");
      Object.assign(row, { months, amount, depositor: t(p.depositor, 30) });
      label = `${months.map((m) => Number(m.slice(5)) + "월").join("·")} 회비 ${amount.toLocaleString()}원`;
    } else if (p.kind === "물품") {
      const item = t(p.item, 80);
      if (!item) throw new HttpError(400, "어떤 물품인지 적어주세요");
      Object.assign(row, { item, qty: t(p.qty, 30) });
      label = `후원물품 ${item}${row.qty ? " " + row.qty : ""}`;
    } else throw new HttpError(400, "회비인지 물품인지 골라주세요");
    await rateLimit(ctx, "dues_submit", 10, 60);
    const e = must(await ctx.db.from("dues_entries").insert(row).select("id").single());
    if (st.treasurers.length) await sendToMembers(await withTelegram(ctx, st.treasurers),
      `💰 <b>확인 요청</b>\n${escHtml(ctx.me.name)} · ${escHtml(label)}${row.depositor ? `\n입금자명 ${escHtml(row.depositor)}` : ""}${row.memo ? `\n${escHtml(row.memo)}` : ""}`,
      appButton("회계 화면 열기", "?go=dues"));
    return { id: e.id, treasurers: st.treasurers.length };
  },
  // 내가 올린 것 취소 { id } (확인 전만)
  async "dues.cancel"(ctx) {
    const e = must(await ctx.db.from("dues_entries").select("id, person_id, status").eq("id", ctx.payload?.id).maybeSingle());
    if (!e || e.person_id !== ctx.me.id) throw new HttpError(404, "없는 요청이에요");
    if (e.status !== "대기") throw new HttpError(400, "확인 전인 것만 취소할 수 있어요");
    must(await ctx.db.from("dues_entries").update({ status: "취소" }).eq("id", e.id));
    return { ok: true };
  },
  // 회계 화면 { team_id, month } (회계 명단만): 확인 기다리는 것 · 그달 과원별 상태 · 합계 · 물품
  async "dues.board"(ctx) {
    const st = await duesSettings(ctx);
    if (!st.treasurers.includes(ctx.me.id)) throw new HttpError(403, "회계담당자만 볼 수 있어요");
    const month = /^\d{4}-\d\d$/.test(String(ctx.payload?.month)) ? String(ctx.payload.month) : kstToday().slice(0, 7);
    const { sectionId, members } = await duesMembers(ctx, ctx.payload?.team_id);
    const nameOf = new Map(members.map((m) => [m.id, m.name]));
    const all: any[] = must(await ctx.db.from("dues_entries").select("id, person_id, kind, months, amount, depositor, item, qty, memo, status, reject_reason, created_at, reviewed_at, reviewed_by")
      .eq("section_id", sectionId).neq("status", "취소").order("created_at", { ascending: false }).limit(1000)) ?? [];
    const pend = all.filter((e) => e.status === "대기");
    const inMonth = all.filter((e) => e.kind === "회비" ? e.months.includes(month) : e.created_at.slice(0, 7) === month);
    const people = members.map((m) => ({ id: m.id, name: m.name, state: duesMonthState(all.filter((e) => e.person_id === m.id), month) }))
      .sort((a, b) => (a.state === "미납" ? 0 : a.state === "대기" ? 1 : 2) - (b.state === "미납" ? 0 : b.state === "대기" ? 1 : 2) || a.name.localeCompare(b.name));
    // 그달 확인된 회비: 기본 회비(한 달 몫) + 넘는 만큼은 후원금 (여러 달이면 달 수로 나눔)
    let fee = 0, extra = 0;
    for (const e of inMonth.filter((x) => x.kind === "회비" && x.status === "확인")) { const per = e.amount / e.months.length; fee += Math.min(per, st.monthly); extra += Math.max(0, per - st.monthly); }
    const named = (e: any) => ({ ...e, name: nameOf.get(e.person_id) ?? "(과 밖)", reviewer: e.reviewed_by ? nameOf.get(e.reviewed_by) ?? "" : "" });
    return {
      month, monthly: st.monthly, pending: pend.map(named), people,
      totals: { fee: Math.round(fee), extra: Math.round(extra), paid: people.filter((x) => x.state === "확인").length, total: people.length },
      items: inMonth.filter((e) => e.kind === "물품").map(named), history: inMonth.filter((e) => e.kind === "회비").map(named),
    };
  },
  // 확인·반려 { id, ok, reason? } (회계 명단만) → 올린 사람에게 알림
  async "dues.review"(ctx) {
    const st = await duesSettings(ctx);
    if (!st.treasurers.includes(ctx.me.id)) throw new HttpError(403, "회계담당자만 할 수 있어요");
    const p = ctx.payload ?? {};
    const e = must(await ctx.db.from("dues_entries").select("id, person_id, kind, months, amount, item, qty, status").eq("id", p.id).maybeSingle());
    if (!e) throw new HttpError(404, "없는 요청이에요");
    if (e.status !== "대기") throw new HttpError(400, "이미 처리된 요청이에요");
    const reason = String(p.reason ?? "").trim().slice(0, 200);
    if (!p.ok && !reason) throw new HttpError(400, "반려 사유를 적어주세요");
    must(await ctx.db.from("dues_entries").update({ status: p.ok ? "확인" : "반려", reviewed_by: ctx.me.id, reviewed_at: new Date().toISOString(), reject_reason: p.ok ? null : reason }).eq("id", e.id));
    const label = e.kind === "회비" ? `${e.months.map((m: string) => Number(m.slice(5)) + "월").join("·")} 회비 ${Number(e.amount).toLocaleString()}원` : `후원물품 ${e.item}${e.qty ? " " + e.qty : ""}`;
    await sendToMembers(await withTelegram(ctx, [e.person_id]), p.ok
      ? `✅ <b>${escHtml(label)}</b> 확인됐어요. 고맙습니다!`
      : `↩️ <b>${escHtml(label)}</b> 확인 요청이 반려됐어요\n사유: ${escHtml(reason)}\n\n확인 후 다시 올려주세요.`, appButton("회비 화면 열기", "?go=dues"));
    return { ok: true };
  },
  // 미납자 연락 { team_id, month } (회계 명단만): 봇이 회계담당자에게 미납자 이름을 누르면 바로 개인 대화로 가는 목록을 보냄
  async "dues.contacts"(ctx) {
    const st = await duesSettings(ctx);
    if (!st.treasurers.includes(ctx.me.id)) throw new HttpError(403, "회계담당자만 할 수 있어요");
    await rateLimit(ctx, "dues_contacts", 5, 10);
    const b: any = await actions["dues.board"](ctx);
    const unpaid = b.people.filter((x: any) => x.state === "미납");
    if (!unpaid.length) return { count: 0 };
    const tg: any[] = await withTelegram(ctx, unpaid.map((x: any) => x.id));
    const lines = tg.map((m) => m.telegram_user_id ? `• <a href="tg://user?id=${m.telegram_user_id}">${escHtml(m.name)}</a>` : `• ${escHtml(m.name)} (텔레그램 번호 없음)`);
    const meTg = await withTelegram(ctx, [ctx.me.id]);
    const r = await sendToMembers(meTg, `💰 <b>${Number(b.month.slice(5))}월 회비 미납 ${unpaid.length}명</b>\n이름을 누르면 그 사람과 개인 대화로 가요.\n\n${lines.join("\n")}`);
    return { count: unpaid.length, sent: r.sent };
  },
  // 회계담당자 지정 { ids } (관리자 명단만): 과원 중에서
  async "dues.setTreasurers"(ctx) {
    const st = await duesSettings(ctx);
    if (!st.admins.includes(ctx.me.id)) throw new HttpError(403, "관리자만 지정할 수 있어요");
    const { members } = await duesMembers(ctx, ctx.payload?.team_id);
    const ids = [...new Set((Array.isArray(ctx.payload?.ids) ? ctx.payload.ids : []).map(String))] as string[];
    if (ids.length > 10 || ids.some((id) => !members.some((m) => m.id === id))) throw new HttpError(400, "과원 중에서 골라주세요");
    must(await ctx.db.from("app_settings").update({ value: ids, updated_by: ctx.me.id, updated_at: new Date().toISOString() }).eq("key", "treasurers"));
    return { treasurers: ids };
  },

  // 내 캐릭터 { } → 지금 꾸민 것 + 고를 수 있는 목록
  async "look.get"(ctx) {
    const p = must(await ctx.db.from("people").select("town_look").eq("id", ctx.me.id).single());
    return { look: p.town_look ?? {}, options: LOOK_OPTS, id: ctx.me.id };
  },
  // 내 캐릭터 저장 { look }: 본인만, 목록 안 값만 (빈 값은 기본 생김새)
  async "look.save"(ctx) {
    const src = ctx.payload?.look ?? {}, out: Record<string, unknown> = {};
    for (const [k, list] of Object.entries(LOOK_OPTS)) {
      const v = src[k];
      if (v === undefined || v === null || v === "") continue;
      if (!list.includes(String(v))) throw new HttpError(400, "고를 수 없는 값이 있어요");
      out[k] = String(v);
    }
    if (src.blush !== undefined) out.blush = !!src.blush;
    await rateLimit(ctx, "look_save", 30, 60);
    must(await ctx.db.from("people").update({ town_look: out, updated_at: new Date().toISOString() }).eq("id", ctx.me.id));
    return { look: out };
  },

  // ----- 하늘방송국 (PC, 실시간 없음): 과원과 층·사무실, 방명록 -----
  // 층: 2층 성우팀 · 3층 아나운서팀 · 4층 엔지니어팀 + 운영진(과 소속 또는 부과장 이상)
  async "sky.load"(ctx) {
    const { team_id } = ctx.payload ?? {};
    await requireRank(ctx, team_id, RANK.MEMBER);
    const units = await sectionUnits(ctx, team_id), sectionId = units[0];
    const day = kstToday();
    const unitRows: any[] = must(await ctx.db.from("org_units").select("id, name").in("id", units)) ?? [];
    const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
    const pos: any[] = must(await ctx.db.from("position_history")
      .select("person_id, org_unit_id, people(name, is_active, town_look), positions(name, rank)")
      .in("org_unit_id", units).lte("started_on", day).or(`ended_on.is.null,ended_on.gte.${day}`)) ?? [];
    const FLOOR: Record<string, number> = { "성우팀": 2, "아나운서팀": 3, "엔지니어팀": 4 };
    const ppl = new Map<string, any>();
    for (const r of pos) {
      if (!r.people?.is_active) continue;
      const rank = r.positions?.rank ?? 0, unit = unitName.get(r.org_unit_id) ?? "";
      const floor = r.org_unit_id === sectionId || rank >= 50 ? 4 : FLOOR[unit] ?? 4;
      const cur = ppl.get(r.person_id);
      if (!cur || rank > cur.rank) ppl.set(r.person_id, { id: r.person_id, name: r.people.name, rank, position: r.positions?.name ?? "", unit: unit || "방송예술과", floor, look: r.people.town_look ?? null });
    }
    const ids = [...ppl.keys()];
    const pb: any[] = ids.length ? must(await ctx.db.from("person_badges").select("person_id, is_title, badges(name, icon)").in("person_id", ids)) ?? [] : [];
    for (const b of pb) { const p = ppl.get(b.person_id); if (!p || !b.badges) continue; (p.badges = p.badges ?? []).push(b.badges.icon); if (b.is_title) p.title = `${b.badges.icon} ${b.badges.name}`; }
    const people = [...ppl.values()].sort((a, b) => a.floor - b.floor || b.rank - a.rank || a.name.localeCompare(b.name));
    return { me: ctx.me.id, people };
  },
  // 방명록 { owner_id }: 주인이면 전부, 아니면 내가 쓴 것만 (쓴 사람과 주인만 봄)
  async "guest.list"(ctx) {
    const owner = String(ctx.payload?.owner_id ?? "");
    if (!UUID_RE.test(owner)) throw new HttpError(400, "사무실을 다시 골라주세요");
    let q = ctx.db.from("guestbook").select("id, author_id, text, created_at").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
    if (owner !== ctx.me.id) q = q.eq("author_id", ctx.me.id);
    const rows: any[] = must(await q) ?? [];
    const names = await nameMap(ctx, rows.map((r) => r.author_id));
    return { mine: owner === ctx.me.id, entries: rows.map((r) => ({ id: r.id, author: names.get(r.author_id) ?? "", by_me: r.author_id === ctx.me.id, text: r.text, at: r.created_at })) };
  },
  // 방명록 쓰기 { team_id, owner_id, text }: 같은 과 사람에게만, 하루 20개. 주인에게 봇 알림(내용은 안 보내고 '방명록이 왔어요'만)
  async "guest.write"(ctx) {
    const p = ctx.payload ?? {};
    const owner = String(p.owner_id ?? ""), text = String(p.text ?? "").trim().slice(0, 200);
    if (!UUID_RE.test(owner) || owner === ctx.me.id) throw new HttpError(400, "다른 사람 사무실에만 쓸 수 있어요");
    if (!text) throw new HttpError(400, "내용을 적어주세요");
    const members = await unitMembers(ctx, await sectionUnits(ctx, p.team_id));
    if (!members.some((m) => m.id === ctx.me.id) || !members.some((m) => m.id === owner)) throw new HttpError(403, "같은 과 사람에게만 쓸 수 있어요");
    await rateLimit(ctx, "guest_write", 20, 24 * 60);
    const e = must(await ctx.db.from("guestbook").insert({ owner_id: owner, author_id: ctx.me.id, text }).select("id").single());
    await sendToMembers(await withTelegram(ctx, [owner]), `📮 <b>${escHtml(ctx.me.name)}</b>님이 하늘방송국 내 사무실에 방명록을 남겼어요`);
    return { id: e.id };
  },
  // 방명록 지우기 { id }: 쓴 사람 또는 사무실 주인
  async "guest.delete"(ctx) {
    const e = must(await ctx.db.from("guestbook").select("id, owner_id, author_id").eq("id", ctx.payload?.id).maybeSingle());
    if (!e || (e.owner_id !== ctx.me.id && e.author_id !== ctx.me.id)) throw new HttpError(404, "없는 글이에요");
    must(await ctx.db.from("guestbook").delete().eq("id", e.id));
    return { ok: true };
  },

  // ----- 첨부 대본 -----
  // 올릴 준비 { kind, item_id, name, size, not_church: true } → 보관함에 바로 올리는 1회용 주소
  async "files.prepare"(ctx) {
    const p = ctx.payload ?? {};
    if (!["notice", "assignment", "session"].includes(p.kind) || !UUID_RE.test(String(p.item_id))) throw new HttpError(400, "글을 다시 골라주세요");
    if (p.not_church !== true) throw new HttpError(400, "우리 교회 대본은 올릴 수 없어요 (NAS에 두세요)");
    const name = String(p.name ?? "").replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 120);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!name || !FILE_EXT.includes(ext)) throw new HttpError(400, "PDF·한글·워드·텍스트 파일만 올릴 수 있어요");
    const size = Number(p.size);
    if (!Number.isInteger(size) || size <= 0 || size > FILE_MAX) throw new HttpError(400, "20MB까지 올릴 수 있어요");
    const tgt: any = await fileCanEdit(ctx, p.kind, p.item_id);
    await rateLimit(ctx, "file_upload", 20, 60);
    const keep = Number(must(await ctx.db.from("app_settings").select("value").eq("key", "file_keep_days").maybeSingle())?.value ?? 14);
    let base = Date.now();
    if (p.kind === "assignment") { const a = must(await ctx.db.from("assignments").select("due_at").eq("id", p.item_id).single()); if (a.due_at) base = Math.max(base, Date.parse(a.due_at)); }
    if (p.kind === "session" && tgt.date) base = Math.max(base, kstMs(tgt.date) + 24 * HOUR);   // 모임: 모임 날부터
    const path = `${p.kind}/${p.item_id}/${crypto.randomUUID()}.${ext}`;
    const up = await ctx.db.storage.from("scripts").createSignedUploadUrl(path);
    if (up.error) throw up.error;
    const row = must(await ctx.db.from("content_files").insert({ kind: p.kind, item_id: p.item_id, path, name, size, uploaded_by: ctx.me.id,
      expires_at: new Date(base + keep * 24 * HOUR).toISOString() }).select("id, expires_at").single());
    return { id: row.id, url: up.data.signedUrl, expires_at: row.expires_at };
  },
  // 다 올렸어요 { id }: 보관함에 실제로 있는지 보고 표시
  async "files.done"(ctx) {
    const f = must(await ctx.db.from("content_files").select("id, path, uploaded_by").eq("id", ctx.payload?.id).maybeSingle());
    if (!f || f.uploaded_by !== ctx.me.id) throw new HttpError(404, "없는 파일이에요");
    const dir = f.path.split("/").slice(0, -1).join("/"), file = f.path.split("/").pop();
    const ls = await ctx.db.storage.from("scripts").list(dir, { search: file });
    if (ls.error || !(ls.data ?? []).some((o: any) => o.name === file)) throw new HttpError(400, "파일이 올라가지 않았어요. 다시 해주세요");
    must(await ctx.db.from("content_files").update({ uploaded: true }).eq("id", f.id));
    return { ok: true };
  },
  // 글들에 붙은 파일 이름 { kind, ids: [] } (내 팀 글이거나 내가 대상인 글만)
  async "files.list"(ctx) {
    const { kind } = ctx.payload ?? {};
    const ids = (Array.isArray(ctx.payload?.ids) ? ctx.payload.ids : []).filter((x: any) => UUID_RE.test(String(x))).slice(0, 200);
    if (!["notice", "assignment", "session"].includes(kind) || !ids.length) return { files: [] };
    const items: any[] = must(await ctx.db.from({ notice: "notices", assignment: "assignments", session: "meeting_sessions" }[kind as string]!).select("id, team_id, target_people").in("id", ids)) ?? [];
    const { teams } = await myTeams(ctx), mine = new Set(teams.map((t: any) => t.id));
    const sec = teams.length ? (await sectionUnits(ctx, teams[0].id))[0] : null;
    const ok = items.filter((i) => mine.has(i.team_id) || i.team_id === sec || i.target_people?.includes(ctx.me.id)).map((i) => i.id);
    if (!ok.length) return { files: [] };
    const rows: any[] = must(await ctx.db.from("content_files").select("id, item_id, name, size, expires_at, uploaded_by").eq("kind", kind).in("item_id", ok).eq("uploaded", true).is("deleted_at", null).order("created_at")) ?? [];
    return { files: rows.map((r) => ({ id: r.id, item_id: r.item_id, name: r.name, size: r.size, expires_at: r.expires_at, mine: r.uploaded_by === ctx.me.id })) };
  },
  // 열기 { id } → 5분짜리 내려받기 주소. 받는 사람만, 연 기록 남김
  async "files.open"(ctx) {
    const f = must(await ctx.db.from("content_files").select("id, kind, item_id, path, name, uploaded, deleted_at").eq("id", ctx.payload?.id).maybeSingle());
    if (!f || !f.uploaded || f.deleted_at) throw new HttpError(404, "기간이 지나 지워졌거나 없는 파일이에요");
    await fileCanOpen(ctx, f.kind, f.item_id);
    const u = await ctx.db.storage.from("scripts").createSignedUrl(f.path, 300, { download: f.name });
    if (u.error) throw u.error;
    await logAccess(ctx, "file_open", "content_files", f.id);
    return { url: u.data.signedUrl, name: f.name };
  },
  // 지우기 { id }: 올린 사람 또는 글 관리하는 사람
  async "files.delete"(ctx) {
    const f = must(await ctx.db.from("content_files").select("id, kind, item_id, path, uploaded_by, deleted_at").eq("id", ctx.payload?.id).maybeSingle());
    if (!f || f.deleted_at) throw new HttpError(404, "없는 파일이에요");
    if (f.uploaded_by !== ctx.me.id) await fileCanEdit(ctx, f.kind, f.item_id);
    await ctx.db.storage.from("scripts").remove([f.path]);
    must(await ctx.db.from("content_files").update({ deleted_at: new Date().toISOString() }).eq("id", f.id));
    return { ok: true };
  },

  // ----- 장소 신청 -----
  // { team_id, date: "YYYY-MM-DD" } → 장소 목록 + 그날 신청(대기·승인) + 내 신청(앞으로) + 내가 승인할 것
  async "place.list"(ctx) {
    const { team_id } = ctx.payload ?? {};
    await requireRank(ctx, team_id, RANK.MEMBER);
    const date = isDate(ctx.payload?.date) ? ctx.payload.date : kstToday();
    const sec = (await sectionUnits(ctx, team_id))[0];
    const day = [new Date(kstMs(date)).toISOString(), new Date(kstMs(date) + 24 * HOUR).toISOString()];
    const [plc, books, mine] = await Promise.all([
      ctx.db.from("places").select("code, name, area, approval").eq("is_active", true).order("area").order("code").then(must),
      ctx.db.from("place_bookings").select("id, place_code, starts_at, ends_at, purpose, person_id, status").in("status", ["대기", "승인"]).lt("starts_at", day[1]).gt("ends_at", day[0]).then(must),
      ctx.db.from("place_bookings").select("id, place_code, starts_at, ends_at, purpose, status, reason").eq("person_id", ctx.me.id).gte("ends_at", new Date(Date.now() - 24 * HOUR).toISOString()).neq("status", "취소").order("starts_at").limit(30).then(must),
    ]);
    const approve: any[] = [];
    for (const k of ["recording", "external"]) {
      if (!(await placeApprovers(ctx, k, sec)).includes(ctx.me.id)) continue;
      const codes = (plc ?? []).filter((p: any) => p.approval === k).map((p: any) => p.code);
      if (codes.length) approve.push(...(must(await ctx.db.from("place_bookings").select("id, place_code, starts_at, ends_at, purpose, person_id, status").eq("status", "대기").in("place_code", codes).order("starts_at")) ?? []));
    }
    const names = await nameMap(ctx, [...(books ?? []), ...approve].map((b: any) => b.person_id));
    const nm = (b: any) => ({ ...b, name: names.get(b.person_id) ?? "", mine: b.person_id === ctx.me.id });
    return { date, places: (plc ?? []).map((p: any) => ({ ...p, rule: PLACE_KIND[p.approval] })), bookings: (books ?? []).map(nm), mine: mine ?? [], approve: approve.map(nm) };
  },
  // 신청 { team_id, place_code, date, from: "HH:MM", to: "HH:MM", purpose } → 스담 등은 바로 승인, 녹음실·외부는 대기 + 승인자 알림
  async "place.book"(ctx) {
    const p = ctx.payload ?? {};
    await requireRank(ctx, p.team_id, RANK.MEMBER);
    const pl = must(await ctx.db.from("places").select("code, name, approval").eq("code", p.place_code).eq("is_active", true).maybeSingle());
    if (!pl) throw new HttpError(400, "장소를 다시 골라주세요");
    if (!isDate(p.date) || !parseHm(String(p.from)) || !parseHm(String(p.to))) throw new HttpError(400, "날짜와 시간을 골라주세요");
    const st = kstMs(p.date, parseHm(String(p.from)) + ":00"), en = kstMs(p.date, parseHm(String(p.to)) + ":00");
    if (en <= st) throw new HttpError(400, "끝나는 시간이 시작보다 늦어야 해요");
    if (st < Date.now() - 30 * 60000) throw new HttpError(400, "지난 시간은 신청할 수 없어요");
    const purpose = String(p.purpose ?? "").trim().slice(0, 100);
    if (!purpose) throw new HttpError(400, "무엇에 쓰는지 적어주세요");
    const clash: any[] = must(await ctx.db.from("place_bookings").select("id, starts_at, ends_at, status").eq("place_code", pl.code).in("status", ["대기", "승인"])
      .lt("starts_at", new Date(en).toISOString()).gt("ends_at", new Date(st).toISOString()).limit(1)) ?? [];
    if (clash.length) throw new HttpError(409, `그 시간엔 이미 ${clash[0].status === "승인" ? "예약" : "신청"}이 있어요 (${kstHm(Date.parse(clash[0].starts_at))}~${kstHm(Date.parse(clash[0].ends_at))})`);
    await rateLimit(ctx, "place_book", 20, 60);
    const auto = pl.approval === "none";
    const row = must(await ctx.db.from("place_bookings").insert({ place_code: pl.code, starts_at: new Date(st).toISOString(), ends_at: new Date(en).toISOString(), purpose,
      team_id: p.team_id, person_id: ctx.me.id, status: auto ? "승인" : "대기", decided_at: auto ? new Date().toISOString() : null }).select("id, status").single());
    let notify = null;
    if (!auto) {
      const sec = (await sectionUnits(ctx, p.team_id))[0];
      const ids = (await placeApprovers(ctx, pl.approval, sec)).filter((x) => x !== ctx.me.id);
      notify = await sendToMembers(await withTelegram(ctx, ids), `🏢 <b>장소 사용 신청</b>\n${escHtml(pl.name)} · ${msLabel(st)}~${kstHm(en)}\n${escHtml(ctx.me.name)} · ${escHtml(purpose)}`,
        appButton("승인하러 가기", "?go=place"));
    }
    return { id: row.id, status: row.status, notify };
  },
  // 승인·반려 { id, ok, reason? } — 그 장소 승인자만. 신청자에게 알림
  async "place.decide"(ctx) {
    const b = must(await ctx.db.from("place_bookings").select("id, place_code, starts_at, ends_at, person_id, status, team_id, places(name, approval)").eq("id", ctx.payload?.id).maybeSingle());
    if (!b || b.status !== "대기") throw new HttpError(400, "이미 처리됐거나 없는 신청이에요");
    const sec = (await sectionUnits(ctx, b.team_id))[0];
    if (!(await placeApprovers(ctx, b.places.approval, sec)).includes(ctx.me.id)) throw new HttpError(403, "이 장소 승인자만 할 수 있어요");
    const ok = ctx.payload?.ok === true, reason = String(ctx.payload?.reason ?? "").trim().slice(0, 200);
    if (!ok && !reason) throw new HttpError(400, "반려 사유를 적어주세요");
    must(await ctx.db.from("place_bookings").update({ status: ok ? "승인" : "반려", decided_by: ctx.me.id, decided_at: new Date().toISOString(), reason: ok ? null : reason }).eq("id", b.id));
    await sendToMembers(await withTelegram(ctx, [b.person_id]), `${ok ? "✅" : "↩️"} <b>${escHtml(b.places.name)}</b> 사용 신청이 ${ok ? "승인됐어요" : "반려됐어요"}\n${msLabel(Date.parse(b.starts_at))}~${kstHm(Date.parse(b.ends_at))}${ok ? "" : "\n사유: " + escHtml(reason)}`,
      appButton("장소 신청 보기", "?go=place"));
    return { ok: true };
  },
  // 취소 { id } — 신청한 사람
  async "place.cancel"(ctx) {
    const b = must(await ctx.db.from("place_bookings").select("id, person_id, status").eq("id", ctx.payload?.id).maybeSingle());
    if (!b || b.person_id !== ctx.me.id) throw new HttpError(404, "없는 신청이에요");
    if (!["대기", "승인"].includes(b.status)) throw new HttpError(400, "이미 끝난 신청이에요");
    must(await ctx.db.from("place_bookings").update({ status: "취소" }).eq("id", b.id));
    return { ok: true };
  },

  // ----- 관리자 페이지 (관리자 명단 admins만) -----
  async "admin.get"(ctx) {
    if (!(await isAdmin(ctx))) throw new HttpError(403, "관리자만 볼 수 있어요");
    const keys = ["admins", "treasurers", "place_approvers", "recap_enabled", "recap_open"];
    const rows: any[] = must(await ctx.db.from("app_settings").select("key, value").in("key", keys)) ?? [];
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const { teams } = await myTeams(ctx);
    const people = teams.length ? (await unitAudience(ctx, (await sectionUnits(ctx, teams[0].id))[0])).map((m: any) => ({ id: m.id, name: m.name, position: m.position, unit: m.unit })) : [];
    return { settings: v, people };
  },
  // { key, value } — 정해진 것만, 사람 id는 과원 중에서
  async "admin.set"(ctx) {
    if (!(await isAdmin(ctx))) throw new HttpError(403, "관리자만 바꿀 수 있어요");
    const { key, value } = ctx.payload ?? {};
    const { teams } = await myTeams(ctx);
    const ids = new Set(teams.length ? (await unitAudience(ctx, (await sectionUnits(ctx, teams[0].id))[0])).map((m: any) => m.id) : []);
    const idList = (x: any) => { const a = [...new Set((Array.isArray(x) ? x : []).map(String))] as string[]; if (a.length > 10 || a.some((i) => !ids.has(i))) throw new HttpError(400, "과원 중에서 골라주세요"); return a; };
    let val: any;
    if (key === "admins") { val = idList(value); if (!val.includes(ctx.me.id)) throw new HttpError(400, "나 자신은 관리자 명단에서 뺄 수 없어요"); }
    else if (key === "treasurers") val = idList(value);
    else if (key === "place_approvers") val = { recording: idList(value?.recording), external: idList(value?.external) };
    else if (key === "recap_enabled") val = value === true;
    else if (key === "recap_open") { if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(value))) throw new HttpError(400, "날짜를 다시 골라주세요"); val = String(value); }
    else throw new HttpError(400, "바꿀 수 없는 설정이에요");
    must(await ctx.db.from("app_settings").upsert({ key, value: val, updated_by: ctx.me.id, updated_at: new Date().toISOString() }));
    return { key, value: val };
  },

  // ----- 인원 특이사항 -----
  // 팀원 한눈에 { team_id } (교관 이상): 진행 중 특이사항·보강 밀린 것·최근 4주 출석률·연속 불참, 신경 쓸 사람이 위로
  async "people.board"(ctx) {
    const { team_id } = ctx.payload ?? {};
    await noteStaff(ctx, team_id);
    const members = await noteMembers(ctx, team_id), ids = members.map((m: any) => m.id);
    const since = addDaysStr(kstToday(), -28);
    const [notes, sess] = await Promise.all([
      ids.length ? ctx.db.from("person_notes").select("person_id, status, followup, followup_done_at, created_at, title, category").eq("team_id", team_id).in("person_id", ids).then(must) : [],
      ctx.db.from("meeting_sessions").select("id, session_date").eq("team_id", team_id).not("closed_at", "is", null).gte("session_date", since).order("session_date").then(must),
    ]);
    const sids = (sess ?? []).map((x: any) => x.id), order = new Map((sess ?? []).map((x: any, i: number) => [x.id, i]));
    const att: any[] = sids.length ? must(await ctx.db.from("attendance").select("session_id, person_id, status").in("session_id", sids)) ?? [] : [];
    const week = Date.now() - 7 * 24 * HOUR;
    const out = members.map((m: any) => {
      const ns = (notes as any[]).filter((n) => n.person_id === m.id);
      const open = ns.filter((n) => n.status === "진행 중"), due = ns.filter((n) => n.followup !== "없음" && !n.followup_done_at);
      const a = att.filter((x) => x.person_id === m.id).sort((x, y) => (order.get(x.session_id) as number) - (order.get(y.session_id) as number));
      const came = a.filter((x) => ["참석", "지각", "조퇴"].includes(x.status)).length;
      let streak = 0; for (let i = a.length - 1; i >= 0 && a[i].status === "불참"; i--) streak++;
      const fresh = ns.filter((n) => Date.parse(n.created_at) > week).length;
      return { id: m.id, name: m.name, position: m.position, group: m.group, open: open.length, latest: open.sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0]?.title ?? null,
        followup: due.length, fresh, rate: a.length ? Math.round(came / a.length * 100) : null, sessions: a.length, streak,
        score: fresh * 3 + due.length * 2 + open.length + (streak >= 2 ? 3 : 0) + (a.length && came / a.length < .6 ? 2 : 0) };
    }).sort((x: any, y: any) => y.score - x.score || x.name.localeCompare(y.name));
    return { members: out };
  },
  // 한 사람 타임라인 { team_id, person_id } (교관 이상): 특이사항(+운영진 메모) + 출결(불참·지각·조퇴와 사유, 사전 불참), 최근 180일. 열람 기록 남김
  async "people.timeline"(ctx) {
    const { team_id, person_id } = ctx.payload ?? {};
    await noteStaff(ctx, team_id);
    const m = (await noteMembers(ctx, team_id)).find((x: any) => x.id === person_id);
    if (!m) throw new HttpError(404, "이 팀 사람이 아니에요");
    const since = addDaysStr(kstToday(), -180);
    const [notes, sess] = await Promise.all([
      ctx.db.from("person_notes").select("*, person_note_comments(id, author_id, body, created_at)").eq("team_id", team_id).eq("person_id", person_id).order("starts_on", { ascending: false }).then(must),
      ctx.db.from("meeting_sessions").select("id, title, session_date, start_time, status, meeting_types(name)").eq("team_id", team_id).gte("session_date", since).neq("status", "취소").then(must),
    ]);
    const sById = new Map((sess ?? []).map((x: any) => [x.id, x]));
    const att: any[] = sById.size ? must(await ctx.db.from("attendance").select("session_id, status, planned_status, planned_reason, reason").eq("person_id", person_id).in("session_id", [...sById.keys()])) ?? [] : [];
    const names = await nameMap(ctx, [...(notes ?? []).flatMap((n: any) => [n.created_by, ...n.person_note_comments.map((c: any) => c.author_id)])]);
    const events = att.filter((a) => ["불참", "지각", "조퇴"].includes(a.status) || (!a.status && a.planned_status && a.planned_status !== "참석")).map((a) => {
      const se: any = sById.get(a.session_id);
      return { date: se.session_date, name: se.title || se.meeting_types?.name || "모임", status: a.status || "사전 " + a.planned_status, reason: a.reason || a.planned_reason || "" };
    }).sort((x, y) => (x.date < y.date ? 1 : -1));
    await logAccess(ctx, "person_timeline", "people", person_id);
    return {
      person: { id: m.id, name: m.name, position: m.position, group: m.group },
      notes: (notes ?? []).map((n: any) => ({ ...n, by: names.get(n.created_by) ?? "", person_note_comments: undefined,
        comments: n.person_note_comments.sort((x: any, y: any) => (x.created_at < y.created_at ? -1 : 1)).map((c: any) => ({ id: c.id, by: names.get(c.author_id) ?? "", body: c.body, at: c.created_at })) })),
      events,
    };
  },
  // 특이사항 쓰기·고치기 { team_id, id?, person_id, category, title, body, starts_on, ends_on, affects, status?, followup? }
  // 교관 이상 = 그 팀 누구든(운영진). 팀원 = 나 자신만(본인), 운영진 기록은 못 고침. 팀원이 새로 알리면 그 팀 교관 이상에게 봇 알림
  async "notes.save"(ctx) {
    const p = ctx.payload ?? {};
    const staff = (await rankIn(ctx, p.team_id)) >= RANK.INSTRUCTOR;
    const members = await noteMembers(ctx, p.team_id);
    if (!members.some((m: any) => m.id === ctx.me.id)) throw new HttpError(403, "이 팀 사람만 쓸 수 있어요");
    const pid = staff ? String(p.person_id ?? ctx.me.id) : ctx.me.id;
    if (!members.some((m: any) => m.id === pid)) throw new HttpError(400, "이 팀 사람을 골라주세요");
    const row = noteFields(p, staff);
    if (p.id) {
      const cur = must(await ctx.db.from("person_notes").select("id, team_id, created_by, source").eq("id", p.id).maybeSingle());
      if (!cur || cur.team_id !== p.team_id) throw new HttpError(404, "없는 기록이에요");
      if (!staff && cur.created_by !== ctx.me.id) throw new HttpError(403, "내가 쓴 것만 고칠 수 있어요");
      return must(await ctx.db.from("person_notes").update(row).eq("id", cur.id).select("id").single());
    }
    await rateLimit(ctx, "note_new", 30, 60);
    const n = must(await ctx.db.from("person_notes").insert({ ...row, team_id: p.team_id, person_id: pid, source: staff && pid !== ctx.me.id ? "운영진" : "본인", created_by: ctx.me.id }).select("id").single());
    if (!staff) {
      const leads = members.filter((m: any) => m.rank >= RANK.INSTRUCTOR && m.id !== ctx.me.id).map((m: any) => m.id);
      await sendToMembers(await withTelegram(ctx, leads), `📝 <b>${escHtml(ctx.me.name)}</b>님이 특이사항을 알렸어요\n[${escHtml(row.category)}] ${escHtml(row.title)}`, appButton("인원 화면 열기", "?go=people"));
    }
    return n;
  },
  // 상태·후속 { id, status?, followup_done? } (교관 이상)
  async "notes.status"(ctx) {
    const p = ctx.payload ?? {};
    const cur = must(await ctx.db.from("person_notes").select("id, team_id").eq("id", p.id).maybeSingle());
    if (!cur) throw new HttpError(404, "없는 기록이에요");
    await noteStaff(ctx, cur.team_id);
    const up: any = {};
    if (p.status !== undefined) { if (!["진행 중", "해결됨"].includes(p.status)) throw new HttpError(400, "상태가 올바르지 않아요"); up.status = p.status; }
    if (p.followup_done !== undefined) up.followup_done_at = p.followup_done ? new Date().toISOString() : null;
    must(await ctx.db.from("person_notes").update(up).eq("id", cur.id));
    return { ok: true };
  },
  // 운영진 메모 { id, body } (교관 이상)
  async "notes.comment"(ctx) {
    const p = ctx.payload ?? {};
    const cur = must(await ctx.db.from("person_notes").select("id, team_id").eq("id", p.id).maybeSingle());
    if (!cur) throw new HttpError(404, "없는 기록이에요");
    await noteStaff(ctx, cur.team_id);
    const body = String(p.body ?? "").trim().slice(0, 500);
    if (!body) throw new HttpError(400, "메모를 적어주세요");
    return must(await ctx.db.from("person_note_comments").insert({ note_id: cur.id, author_id: ctx.me.id, body }).select("id").single());
  },
  // 지우기 { id }: 쓴 사람 또는 교관 이상
  async "notes.delete"(ctx) {
    const cur = must(await ctx.db.from("person_notes").select("id, team_id, created_by").eq("id", ctx.payload?.id).maybeSingle());
    if (!cur) throw new HttpError(404, "없는 기록이에요");
    if (cur.created_by !== ctx.me.id) await noteStaff(ctx, cur.team_id);
    must(await ctx.db.from("person_notes").delete().eq("id", cur.id));
    return { ok: true };
  },
  // 내가 알린 특이사항 { team_id } (누구나, 내가 쓴 본인 것만. 운영진 기록·메모는 안 보임)
  async "notes.mine"(ctx) {
    const rows: any[] = must(await ctx.db.from("person_notes").select("id, team_id, category, title, body, starts_on, ends_on, affects, status, created_at")
      .eq("person_id", ctx.me.id).eq("created_by", ctx.me.id).eq("source", "본인").order("starts_on", { ascending: false }).limit(50)) ?? [];
    return rows;
  },

  // ----- 회의 모드 -----
  // 열기 { session_id } → 없으면 만듦(진행자 = 모임 만든 사람). 안건·의견·주차장·할 일·참석자(의견 준비 여부)·내 역할
  async "mtg.get"(ctx) {
    const sid = String(ctx.payload?.session_id ?? "");
    if (!UUID_RE.test(sid)) throw new HttpError(400, "모임을 다시 골라주세요");
    let m = must(await ctx.db.from("meetings").select("*").eq("session_id", sid).maybeSingle());
    if (!m) {
      const s = must(await ctx.db.from("meeting_sessions").select("id, team_id, created_by").eq("id", sid).maybeSingle());
      if (!s) throw new HttpError(404, "모임을 찾을 수 없어요");
      await mtgAccess(ctx, { session_id: s.id, team_id: s.team_id, chair_id: s.created_by });
      const ins = await ctx.db.from("meetings").insert({ session_id: s.id, team_id: s.team_id, chair_id: s.created_by }).select("*").single();
      m = ins.error?.code === "23505" ? must(await ctx.db.from("meetings").select("*").eq("session_id", sid).single()) : must(ins);
    }
    const a = await mtgAccess(ctx, m);
    const [items, parked, acts] = await Promise.all([
      ctx.db.from("meeting_items").select("*, meeting_opinions(person_id, body, updated_at)").eq("meeting_id", m.id).order("sort").order("created_at").then(must),
      ctx.db.from("meeting_parked").select("id, text, created_by, created_at").eq("meeting_id", m.id).order("created_at").then(must),
      ctx.db.from("meeting_actions").select("id, item_id, assignee_id, task, due_on, done_at").eq("meeting_id", m.id).order("created_at").then(must),
    ]);
    const ids = [m.chair_id, m.scribe_id, ...a.members.map((x: any) => x.id), ...(items ?? []).flatMap((i: any) => [i.created_by, i.person_id, ...i.meeting_opinions.map((o: any) => o.person_id)]), ...(acts ?? []).map((x: any) => x.assignee_id)].filter(Boolean);
    const names = await nameMap(ctx, ids);
    const real = (items ?? []).filter((i: any) => i.kind !== "할 일 점검");
    const s = a.s;
    return {
      meeting: { ...m, chair: names.get(m.chair_id) ?? "", scribe: m.scribe_id ? names.get(m.scribe_id) ?? "" : null, server_now: Date.now() },
      session: { id: s.id, title: s.title || s.meeting_types?.name || "회의", date: s.session_date, start: s.start_time, end: s.end_time, location: s.location },
      me: { id: ctx.me.id, chair: a.chair, scribe: a.scribe },
      members: a.members.map((x: any) => ({ id: x.id, name: x.name, ready: real.length > 0 && real.every((i: any) => i.meeting_opinions.some((o: any) => o.person_id === x.id)) })),
      items: (items ?? []).map((i: any) => ({ ...i, by: names.get(i.created_by) ?? "", person: i.person_id ? names.get(i.person_id) ?? "" : null, meeting_opinions: undefined,
        opinions: i.meeting_opinions.map((o: any) => ({ person_id: o.person_id, name: names.get(o.person_id) ?? "", body: o.body })) })),
      parked: (parked ?? []).map((x: any) => ({ id: x.id, text: x.text, by: names.get(x.created_by) ?? "" })),
      actions: (acts ?? []).map((x: any) => ({ ...x, name: names.get(x.assignee_id) ?? "" })),
    };
  },
  // 안건 올리기·고치기 { meeting_id, id?, kind, title, background, decide, options, minutes_min, priority, person_id? } — 참석자 누구나 올림, 고치기는 올린 사람·진행자
  async "mtg.item"(ctx) {
    const p = ctx.payload ?? {};
    const m = await mtgLoad(ctx, p.meeting_id), a = await mtgAccess(ctx, m);
    if (m.status === "끝") throw new HttpError(400, "끝난 회의예요");
    const t = (v: any, n: number) => String(v ?? "").trim().slice(0, n) || null;
    const row: any = { kind: ["일반", "인원"].includes(p.kind) ? p.kind : "일반", title: t(p.title, 80), background: t(p.background, 1000), decide: t(p.decide, 500), options: t(p.options, 500),
      minutes_min: Math.max(1, Math.min(120, Number(p.minutes_min) || 10)), priority: [1, 2, 3].includes(Number(p.priority)) ? Number(p.priority) : 2,
      person_id: p.kind === "인원" && UUID_RE.test(String(p.person_id)) ? p.person_id : null };
    if (!row.title) throw new HttpError(400, "안건 제목을 적어주세요");
    if (p.id) {
      const cur = must(await ctx.db.from("meeting_items").select("id, created_by, meeting_id").eq("id", p.id).maybeSingle());
      if (!cur || cur.meeting_id !== m.id) throw new HttpError(404, "없는 안건이에요");
      if (cur.created_by !== ctx.me.id && !a.chair) throw new HttpError(403, "올린 사람이나 진행자만 고칠 수 있어요");
      return must(await ctx.db.from("meeting_items").update(row).eq("id", cur.id).select("id").single());
    }
    await rateLimit(ctx, "mtg_item", 30, 60);
    return must(await ctx.db.from("meeting_items").insert({ ...row, meeting_id: m.id, created_by: ctx.me.id, sort: 100 }).select("id").single());
  },
  async "mtg.itemDelete"(ctx) {
    const cur = must(await ctx.db.from("meeting_items").select("id, created_by, meeting_id").eq("id", ctx.payload?.id).maybeSingle());
    if (!cur) throw new HttpError(404, "없는 안건이에요");
    const m = await mtgLoad(ctx, cur.meeting_id), a = await mtgAccess(ctx, m);
    if (cur.created_by !== ctx.me.id && !a.chair) throw new HttpError(403, "올린 사람이나 진행자만 지울 수 있어요");
    must(await ctx.db.from("meeting_items").delete().eq("id", cur.id));
    return { ok: true };
  },
  // 내 의견 { item_id, body } (참석자, 비우면 지움)
  async "mtg.opinion"(ctx) {
    const it = must(await ctx.db.from("meeting_items").select("id, meeting_id").eq("id", ctx.payload?.item_id).maybeSingle());
    if (!it) throw new HttpError(404, "없는 안건이에요");
    await mtgAccess(ctx, await mtgLoad(ctx, it.meeting_id));
    const body = String(ctx.payload?.body ?? "").trim().slice(0, 500);
    if (!body) { must(await ctx.db.from("meeting_opinions").delete().eq("item_id", it.id).eq("person_id", ctx.me.id)); return { ok: true }; }
    must(await ctx.db.from("meeting_opinions").upsert({ item_id: it.id, person_id: ctx.me.id, body, updated_at: new Date().toISOString() }));
    return { ok: true };
  },
  // 서기 지정 { meeting_id, person_id } (진행자)
  async "mtg.scribe"(ctx) {
    const m = await mtgLoad(ctx, ctx.payload?.meeting_id), a = await mtgAccess(ctx, m); mtgChair(a);
    const pid = ctx.payload?.person_id || null;
    if (pid && !a.members.some((x: any) => x.id === pid)) throw new HttpError(400, "참석자 중에서 골라주세요");
    must(await ctx.db.from("meetings").update({ scribe_id: pid }).eq("id", m.id));
    return { ok: true };
  },
  // 시작 { meeting_id } (진행자): 지난 회의(같은 팀)에서 안 끝난 할 일이 있으면 '지난 할 일 점검'을 맨 앞에. 안건은 중요도 순으로 정렬
  async "mtg.start"(ctx) {
    const m = await mtgLoad(ctx, ctx.payload?.meeting_id), a = await mtgAccess(ctx, m); mtgChair(a);
    if (m.status !== "준비") throw new HttpError(400, "이미 시작한 회의예요");
    const left: any[] = must(await ctx.db.from("meeting_actions").select("id").eq("team_id", m.team_id).is("done_at", null).neq("meeting_id", m.id).limit(1)) ?? [];
    const has = must(await ctx.db.from("meeting_items").select("id").eq("meeting_id", m.id).eq("kind", "할 일 점검").maybeSingle());
    if (left.length && !has) must(await ctx.db.from("meeting_items").insert({ meeting_id: m.id, kind: "할 일 점검", title: "지난 회의 할 일 점검", minutes_min: 5, priority: 1, created_by: ctx.me.id }));
    const its: any[] = must(await ctx.db.from("meeting_items").select("id, kind, priority, created_at").eq("meeting_id", m.id)) ?? [];
    its.sort((x, y) => (x.kind === "할 일 점검" ? -1 : 0) - (y.kind === "할 일 점검" ? -1 : 0) || x.priority - y.priority || (x.created_at < y.created_at ? -1 : 1));
    for (let i = 0; i < its.length; i++) must(await ctx.db.from("meeting_items").update({ sort: i }).eq("id", its[i].id));
    const first = its[0]?.id ?? null;
    if (first) must(await ctx.db.from("meeting_items").update({ status: "논의 중" }).eq("id", first));
    must(await ctx.db.from("meetings").update({ status: "진행", started_at: new Date().toISOString(), current_item_id: first, item_started_at: first ? new Date().toISOString() : null }).eq("id", m.id));
    return { ok: true };
  },
  // 다음으로 { meeting_id, outcome: 결론|넘김, to?: item_id } (진행자): 지금 안건을 결론/넘김으로 닫고 다음(또는 고른) 안건으로
  async "mtg.next"(ctx) {
    const p = ctx.payload ?? {};
    const m = await mtgLoad(ctx, p.meeting_id), a = await mtgAccess(ctx, m); mtgChair(a);
    if (m.status !== "진행") throw new HttpError(400, "진행 중인 회의가 아니에요");
    if (m.current_item_id && ["결론", "넘김"].includes(p.outcome)) must(await ctx.db.from("meeting_items").update({ status: p.outcome }).eq("id", m.current_item_id));
    const its: any[] = must(await ctx.db.from("meeting_items").select("id, status, sort").eq("meeting_id", m.id).order("sort")) ?? [];
    const nxt = p.to && its.some((i) => i.id === p.to) ? p.to : its.find((i) => i.status === "대기")?.id ?? null;
    if (nxt) must(await ctx.db.from("meeting_items").update({ status: "논의 중" }).eq("id", nxt));
    must(await ctx.db.from("meetings").update({ current_item_id: nxt, item_started_at: nxt ? new Date().toISOString() : null }).eq("id", m.id));
    return { current: nxt };
  },
  // 시간 늘리기 { meeting_id, min } (진행자)
  async "mtg.extend"(ctx) {
    const m = await mtgLoad(ctx, ctx.payload?.meeting_id), a = await mtgAccess(ctx, m); mtgChair(a);
    if (!m.current_item_id) throw new HttpError(400, "지금 다루는 안건이 없어요");
    const it = must(await ctx.db.from("meeting_items").select("extended_min").eq("id", m.current_item_id).single());
    must(await ctx.db.from("meeting_items").update({ extended_min: Math.min(120, it.extended_min + (Number(ctx.payload?.min) || 5)) }).eq("id", m.current_item_id));
    return { ok: true };
  },
  // 서기 칸 { item_id, summary?, decision? } (진행자·서기)
  async "mtg.note"(ctx) {
    const p = ctx.payload ?? {};
    const it = must(await ctx.db.from("meeting_items").select("id, meeting_id").eq("id", p.item_id).maybeSingle());
    if (!it) throw new HttpError(404, "없는 안건이에요");
    const a = await mtgAccess(ctx, await mtgLoad(ctx, it.meeting_id)); mtgWriter(a);
    const up: any = {};
    if (p.summary !== undefined) up.summary = String(p.summary ?? "").slice(0, 2000) || null;
    if (p.decision !== undefined) up.decision = String(p.decision ?? "").slice(0, 1000) || null;
    must(await ctx.db.from("meeting_items").update(up).eq("id", it.id));
    return { ok: true };
  },
  // 주차장 '나중에' { meeting_id, text } (참석자 누구나) / 지우기 { id } (진행자·쓴 사람)
  async "mtg.park"(ctx) {
    const m = await mtgLoad(ctx, ctx.payload?.meeting_id); await mtgAccess(ctx, m);
    const text = String(ctx.payload?.text ?? "").trim().slice(0, 200);
    if (!text) throw new HttpError(400, "무엇을 나중에 얘기할지 적어주세요");
    return must(await ctx.db.from("meeting_parked").insert({ meeting_id: m.id, text, created_by: ctx.me.id }).select("id").single());
  },
  async "mtg.unpark"(ctx) {
    const x = must(await ctx.db.from("meeting_parked").select("id, meeting_id, created_by").eq("id", ctx.payload?.id).maybeSingle());
    if (!x) throw new HttpError(404, "없어요");
    const a = await mtgAccess(ctx, await mtgLoad(ctx, x.meeting_id));
    if (!a.chair && x.created_by !== ctx.me.id) throw new HttpError(403, "진행자나 쓴 사람만 지울 수 있어요");
    must(await ctx.db.from("meeting_parked").delete().eq("id", x.id));
    return { ok: true };
  },
  // 할 일 { meeting_id, item_id?, id?, assignee_id, task, due_on? } (진행자·서기) / 지우기
  async "mtg.action"(ctx) {
    const p = ctx.payload ?? {};
    const m = await mtgLoad(ctx, p.meeting_id), a = await mtgAccess(ctx, m); mtgWriter(a);
    const task = String(p.task ?? "").trim().slice(0, 200);
    if (!task) throw new HttpError(400, "할 일을 적어주세요");
    if (!a.members.some((x: any) => x.id === p.assignee_id) && p.assignee_id !== m.chair_id) throw new HttpError(400, "담당자를 참석자 중에서 골라주세요");
    const row = { task, assignee_id: p.assignee_id, due_on: isDate(p.due_on) ? p.due_on : null, item_id: UUID_RE.test(String(p.item_id)) ? p.item_id : null };
    if (p.id) return must(await ctx.db.from("meeting_actions").update(row).eq("id", p.id).eq("meeting_id", m.id).select("id").single());
    return must(await ctx.db.from("meeting_actions").insert({ ...row, meeting_id: m.id, team_id: m.team_id, created_by: ctx.me.id }).select("id").single());
  },
  async "mtg.actionDelete"(ctx) {
    const x = must(await ctx.db.from("meeting_actions").select("id, meeting_id").eq("id", ctx.payload?.id).maybeSingle());
    if (!x) throw new HttpError(404, "없어요");
    mtgWriter(await mtgAccess(ctx, await mtgLoad(ctx, x.meeting_id)));
    must(await ctx.db.from("meeting_actions").delete().eq("id", x.id));
    return { ok: true };
  },
  // 할 일 끝 { id, done } (담당자·진행자)
  async "mtg.actionDone"(ctx) {
    const x = must(await ctx.db.from("meeting_actions").select("id, assignee_id, meeting_id").eq("id", ctx.payload?.id).maybeSingle());
    if (!x) throw new HttpError(404, "없어요");
    if (x.assignee_id !== ctx.me.id) mtgChair(await mtgAccess(ctx, await mtgLoad(ctx, x.meeting_id)));
    must(await ctx.db.from("meeting_actions").update({ done_at: ctx.payload?.done === false ? null : new Date().toISOString() }).eq("id", x.id));
    return { ok: true };
  },
  // 끝내기 { meeting_id } (진행자): 담당자마다 맡은 일 알림
  async "mtg.end"(ctx) {
    const m = await mtgLoad(ctx, ctx.payload?.meeting_id), a = await mtgAccess(ctx, m); mtgChair(a);
    if (m.status === "끝") return { ok: true };
    if (m.current_item_id) must(await ctx.db.from("meeting_items").update({ status: "결론" }).eq("id", m.current_item_id).eq("status", "논의 중"));
    must(await ctx.db.from("meetings").update({ status: "끝", ended_at: new Date().toISOString(), current_item_id: null }).eq("id", m.id));
    const acts: any[] = must(await ctx.db.from("meeting_actions").select("assignee_id, task, due_on").eq("meeting_id", m.id).is("done_at", null)) ?? [];
    const by = new Map<string, any[]>(); for (const x of acts) by.set(x.assignee_id, [...(by.get(x.assignee_id) ?? []), x]);
    let sent = 0;
    for (const p of await withTelegram(ctx, [...by.keys()])) {
      const r = await sendToMembers([p], `📋 <b>${escHtml(a.s.title || a.s.meeting_types?.name || "회의")}에서 맡은 일</b>\n` + by.get(p.id)!.map((x) => `• ${escHtml(x.task)}${x.due_on ? ` (${x.due_on.slice(5).replace("-", "/")}까지)` : ""}`).join("\n"), appButton("할 일 보기", "?go=profile"));
      sent += r.sent;
    }
    return { ok: true, sent };
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
      .select("role, recording_roles(name), recording_sessions!inner(id, scheduled_start, scheduled_end, location, status, retake_of, recording_requests(title, request_code, request_dept))")
      .eq("person_id", ctx.me.id).eq("selected", true).in("recording_sessions.status", ["예정", "완료", "재녹음필요"])
      .gte("recording_sessions.scheduled_start", fromTs).lt("recording_sessions.scheduled_start", nextTs)) ?? [], [] as any[]);
    const recs = parts.map((r) => ({
      start: r.recording_sessions.scheduled_start, end: r.recording_sessions.scheduled_end,
      location: r.recording_sessions.location, status: r.recording_sessions.status, retake: !!r.recording_sessions.retake_of,
      title: r.recording_sessions.recording_requests?.title ?? null, code: r.recording_sessions.recording_requests?.request_code ?? null,
      dept: r.recording_sessions.recording_requests?.request_dept ?? null,
      role: r.role, cast: r.recording_roles?.name ?? null,
    })).sort((a, b) => (a.start < b.start ? -1 : 1));
    const recAll = await safe("녹음 누적", async () => {
      const r = await ctx.db.from("recording_participants")
        .select("id, recording_sessions!inner(status)", { count: "exact", head: true })
        .eq("person_id", ctx.me.id).eq("selected", true).eq("recording_sessions.status", "완료");
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
    // 대상을 사람으로 집은 경우: 전체(과)는 팀장 이상, 팀은 그 팀 사람만
    const target_people = await pickedPeople(ctx, p, RANK.GROUP_LEADER, RANK.TEAM_LEADER);
    // 같이 받을 체크인 항목 (기상·출발·도착 중 고른 것만, 없으면 체크인 안 만듦)
    const ciItems = ["기상", "출발", "도착"].filter((x) => Array.isArray(p.checkin_items) && p.checkin_items.includes(x));
    if (p.notify !== false) await rateLimit(ctx, "sess_new", 10, 30);
    const s = must(await ctx.db.from("meeting_sessions").insert({
      target_people, target_label: target_people ? String(p.target_label ?? "").slice(0, 60) || null : null,
      ...pick(p, ["meeting_type_id", "session_date", "start_time", "end_time", "place_mode"]),
      title: String(p.title ?? "").trim().slice(0, 60) || null,
      location: String(p.location ?? "").trim().slice(0, 40) || null,
      description: String(p.description ?? "").trim().slice(0, 2000) || null,
      target_unit_id: p.target_unit_id || null,
      team_id: p.team_id,
      created_by: ctx.me.id,
    }).select(SESSION_COLS).single());
    if (ciItems.length) {
      const c = must(await ctx.db.from("checkins").insert({
        team_id: s.team_id, session_id: s.id, title: sessionName(s), check_date: s.session_date, items: ciItems,
        target_unit_id: s.target_unit_id, target_people: s.target_people, target_label: s.target_label, created_by: ctx.me.id,
      }).select("id, items").single());
      s.checkins = [c];
    }
    const notify = p.notify === false ? null : await notifyMembers(ctx, s, "new");
    return { ...s, notify };
  },

  // ----- 개인노트 '지금 할 일': 내 팀들에서 내가 바로 해야 하는 것 모음 (아래 탭 숫자 배지) -----
  // 업무가능 미제출 · 사전체크 안 한 모임 · 사유 안 쓴 지각/불참/조퇴 · 안 낸 과제 · 안 읽은 공지(2주 안) · 오늘 체크인 안 한 항목
  async "todos.list"(ctx) {
    const me = ctx.me.id, now = Date.now(), today = kstToday();
    const teams = (await myTeams(ctx)).teams.filter((t: any) => t.rank >= RANK.MEMBER);
    const items: any[] = [];
    // 1) 업무가능: 이번 주 미제출(독촉 시작 주부터) / 다음 주 마감 3일 전부터 미제출
    const dow = new Date(today + "T00:00:00Z").getUTCDay();
    const thisMon = addDaysStr(today, -((dow + 6) % 7)), nextMon = addDaysStr(thisMon, 7);
    const nextDue = kstMs(addDaysStr(nextMon, -1), "22:00:00");
    const subs: any[] = must(await ctx.db.from("weekly_submissions").select("week_start").eq("person_id", me).in("week_start", [thisMon, nextMon])) ?? [];
    const done = new Set(subs.map((x) => x.week_start));
    if (!done.has(thisMon) && thisMon >= NAG_FROM) items.push({ kind: "weekly", which: "this", week_start: thisMon, urgent: true });
    if (!done.has(nextMon) && now > nextDue - 3 * 24 * HOUR) items.push({ kind: "weekly", which: "next", week_start: nextMon, due: nextDue, urgent: now > nextDue });
    const seenIds = new Set<string>();
    const once = (k: string) => { if (seenIds.has(k)) return false; seenIds.add(k); return true; };
    const groups = await myGroupIds(ctx);
    const targeted = (r: any) => r.target_people?.length ? r.target_people.includes(me) : !r.target_unit_id || groups.includes(r.target_unit_id);
    for (const t of teams) {
      const sub = { ...ctx, payload: { team_id: t.id } } as Ctx;
      const [sess, tasks, notes, cis] = await Promise.all([
        actions["sessions.list"]({ ...sub, payload: { team_id: t.id, from: addDaysStr(today, -14), to: addDaysStr(today, 60) } }).catch(() => []),
        actions["assignments.list"](sub).catch(() => []),
        actions["notices.list"](sub).catch(() => []),
        actions["checkins.list"](sub).catch(() => []),
      ]) as any[][];
      for (const s of sess) {
        const m = s.mine;
        if (m && ["지각", "불참", "조퇴"].includes(m.status) && !m.reason && once("r" + s.id))
          items.push({ kind: "reason", id: s.id, team_id: s.team_id, name: sessionName(s), date: s.session_date, status: m.status, urgent: true });
        else if (s.is_target && s.status === "예정" && !s.closed_at && now < planDeadline(s) && !(m && (m.planned_status || m.status)) && once("p" + s.id))
          items.push({ kind: "plan", id: s.id, team_id: s.team_id, name: sessionName(s), date: s.session_date, start: s.start_time, urgent: planDeadline(s) - now < 24 * HOUR });
      }
      for (const a of tasks) {
        if (a.my || a.created_by === me || !targeted(a)) continue;
        const due = a.due_at ? Date.parse(a.due_at) : null;
        if (due !== null && due < now) continue;
        if (once("a" + a.id)) items.push({ kind: "task", id: a.id, team_id: a.team_id, name: a.title, due: a.due_at, urgent: due !== null && due - now < 24 * HOUR });
      }
      for (const n of notes) {
        if (n.seen || Date.parse(n.published_at) < now - 14 * 24 * HOUR) continue;
        if (once("n" + n.id)) items.push({ kind: "notice", id: n.id, team_id: t.id, name: n.title, at: n.published_at, pinned: n.is_pinned });
      }
      for (const c of cis) {
        if (c.check_date !== today || !targeted(c)) continue;
        // 뒤 항목을 이미 냈으면 앞 항목은 할 일에서 뺌 (예: '도착'을 눌렀으면 기상·출발도 끝)
        const its: string[] = c.items ?? [], lastDone = Math.max(-1, ...its.map((it, i) => (c.mine?.[it] ? i : -1)));
        const left = its.filter((it, i) => i > lastDone && !c.mine?.[it]);
        if (left.length && once("c" + c.id)) items.push({ kind: "checkin", id: c.id, team_id: c.team_id, name: c.title, left });
      }
    }
    // 녹음 요청에 아직 답하지 않은 것 (조율 중인 회차, 시작 전)
    const asks: any[] = must(await ctx.db.from("recording_participants")
      .select("id, role, recording_sessions!inner(id, status, scheduled_start, location, recording_requests(title))")
      .eq("person_id", me).eq("answer", "대기").eq("recording_sessions.status", "조율중")
      .gt("recording_sessions.scheduled_start", new Date(now).toISOString())) ?? [];
    for (const a of asks) {
      const st = Date.parse(a.recording_sessions.scheduled_start);
      items.push({ kind: "recask", id: a.id, name: a.recording_sessions.recording_requests?.title ?? "녹음", role: REC_ROLE_KO[a.role] ?? a.role,
        start: st, place: a.recording_sessions.location ?? "", urgent: st - now < 48 * HOUR });
    }
    // 오늘 녹음: 성우는 '녹음실 도착', 엔지니어는 '시작 보고'·'녹음 마쳤습니다'
    const recToday: any[] = must(await ctx.db.from("recording_participants")
      .select("id, role, arrived_at, recording_sessions!inner(id, status, scheduled_start, scheduled_end, started_at, ended_at, location, recording_requests(title))")
      .eq("person_id", me).eq("selected", true).eq("recording_sessions.status", "예정")
      .gte("recording_sessions.scheduled_start", new Date(now - 6 * HOUR).toISOString()).lt("recording_sessions.scheduled_start", new Date(now + 2 * HOUR).toISOString())) ?? [];
    for (const a of recToday) {
      const rs = a.recording_sessions, st = Date.parse(rs.scheduled_start), name = rs.recording_requests?.title ?? "녹음";
      if (!recArriveOpen(rs)) continue;
      if (a.role === "엔지니어") items.push({ kind: "recrun", id: a.id, name, step: rs.started_at ? "end" : "start", start: st, place: rs.location ?? "", urgent: true });
      else if (!a.arrived_at) items.push({ kind: "recarrive", id: a.id, name, start: st, place: rs.location ?? "", urgent: true });
    }
    // 회의에서 맡은 일 (안 끝난 것)
    const macts: any[] = must(await ctx.db.from("meeting_actions").select("id, task, due_on").eq("assignee_id", me).is("done_at", null).order("due_on")) ?? [];
    for (const a of macts) items.push({ kind: "mtgaction", id: a.id, name: a.task, due: a.due_on, urgent: !!a.due_on && a.due_on <= addDaysStr(kstToday(), 1) });
    // 사흘 안 회의인데 안건에 의견을 다 안 남긴 것
    const soon: any[] = must(await ctx.db.from("meetings").select("id, session_id, meeting_sessions!inner(session_date, title, team_id, target_unit_id, target_people, meeting_types(name))").eq("status", "준비")
      .gte("meeting_sessions.session_date", kstToday()).lte("meeting_sessions.session_date", addDaysStr(kstToday(), 3))) ?? [];
    for (const m of soon) {
      const its: any[] = must(await ctx.db.from("meeting_items").select("id").eq("meeting_id", m.id).neq("kind", "할 일 점검")) ?? [];
      if (!its.length) continue;
      const mine: any[] = must(await ctx.db.from("meeting_opinions").select("item_id").eq("person_id", me).in("item_id", its.map((i) => i.id))) ?? [];
      if (mine.length >= its.length) continue;
      if (!(await sessionMembers(ctx, { ...m.meeting_sessions, id: m.session_id })).some((x: any) => x.id === me)) continue;
      items.push({ kind: "mtgprep", id: m.session_id, team_id: m.meeting_sessions.team_id, name: m.meeting_sessions.title || m.meeting_sessions.meeting_types?.name || "회의", left: its.length - mine.length, date: m.meeting_sessions.session_date, urgent: m.meeting_sessions.session_date <= addDaysStr(kstToday(), 1) });
    }
    // 시간취합: 대상인데 아직 안 칠한 것 (내가 만든 건 빼고)
    const polls: any[] = must(await ctx.db.from("time_polls").select("id, title, deadline, created_by").contains("target_people", [me])
      .eq("status", "진행중").gt("deadline", new Date(now).toISOString())) ?? [];
    const pollIds = polls.filter((p) => p.created_by !== me).map((p) => p.id);
    const pollDone: any[] = pollIds.length ? must(await ctx.db.from("time_poll_answers").select("poll_id").eq("person_id", me).in("poll_id", pollIds)) ?? [] : [];
    for (const p of polls) {
      if (p.created_by === me || pollDone.some((x) => x.poll_id === p.id)) continue;
      const due = Date.parse(p.deadline);
      items.push({ kind: "poll", id: p.id, name: p.title, due: p.deadline, urgent: due - now < 24 * HOUR });
    }
    const order: Record<string, number> = { reason: 0, recask: 1, weekly: 2, checkin: 3, poll: 4, plan: 5, task: 6, notice: 7 };
    items.sort((x, y) => (y.urgent ? 1 : 0) - (x.urgent ? 1 : 0) || order[x.kind] - order[y.kind]);
    return { count: items.length, items };
  },

  // ----- 개인 양식(템플릿): 만들기 화면 입력 상태를 저장해 두고 다시 채움 -----
  // { kind } → 내 양식 목록
  async "templates.list"(ctx) {
    return must(await ctx.db.from("user_templates").select("id, name, data, updated_at")
      .eq("person_id", ctx.me.id).eq("kind", String(ctx.payload.kind ?? "")).order("name")) ?? [];
  },
  // { kind, name, data } → 같은 이름이면 덮어씀. 종류마다 20개까지
  async "templates.save"(ctx) {
    const kind = String(ctx.payload.kind ?? "").slice(0, 20), name = String(ctx.payload.name ?? "").trim().slice(0, 30);
    if (!["session", "assignment", "checkin", "notice"].includes(kind)) throw new HttpError(400, "양식 종류가 올바르지 않습니다");
    if (!name) throw new HttpError(400, "양식 이름을 적어주세요");
    const data = ctx.payload.data;
    if (!data || typeof data !== "object" || JSON.stringify(data).length > 8000) throw new HttpError(400, "양식 내용이 올바르지 않습니다");
    const { count } = await ctx.db.from("user_templates").select("id", { count: "exact", head: true }).eq("person_id", ctx.me.id).eq("kind", kind).neq("name", name);
    if ((count ?? 0) >= 20) throw new HttpError(400, "양식은 20개까지 만들 수 있어요. 안 쓰는 걸 지워주세요");
    return must(await ctx.db.from("user_templates").upsert(
      { person_id: ctx.me.id, kind, name, data, updated_at: new Date().toISOString() },
      { onConflict: "person_id,kind,name" }).select("id, name, data, updated_at").single());
  },
  // { id } → 내 것만
  async "templates.delete"(ctx) {
    must(await ctx.db.from("user_templates").delete().eq("id", ctx.payload.id).eq("person_id", ctx.me.id));
    return { ok: true };
  },

  // 모임 대상 고르기: { team_id } → 과의 팀들(만들 수 있는지), 팀마다 조, 사람 명단(팀별 서열). 조장 이상
  async "sessions.audience"(ctx) {
    const roster = await sectionRoster(ctx, ctx.payload.team_id);
    const ranks = await Promise.all(roster.teams.map((t: any) => rankIn(ctx, t.id)));
    // 시간취합은 누구나 대상을 고르니 과 사람이면 명단을 받음 (만들 수 있는지는 각 '만들기'에서 서열로 다시 확인)
    if (!ranks.some((r) => r >= RANK.MEMBER)) throw new HttpError(403, "권한이 없습니다");
    return {
      section: roster.section,
      can_all: ranks.some((r) => r >= RANK.TEAM_LEADER),
      teams: roster.teams.map((t: any, i: number) => ({ ...t, can: ranks[i] >= RANK.GROUP_LEADER, my_rank: ranks[i] })),
      members: roster.members,
    };
  },

  // 모임 고치기·취소: { id, ...고칠 칸, notify? } → 조장 이상
  // 취소하면 대상자에게 알림. 날짜·시간·장소를 바꿨을 땐 notify: true일 때만 알림
  async "sessions.update"(ctx) {
    const before = await getSession(ctx, ctx.payload.id);
    await requireRank(ctx, before.team_id, RANK.GROUP_LEADER);
    const patch = pick(ctx.payload, ["title", "session_date", "start_time", "end_time", "location", "place_mode", "status", "description"]);
    if ("status" in patch && !["예정", "취소"].includes(patch.status)) throw new HttpError(400, "상태가 올바르지 않습니다");
    if ("session_date" in patch && !isDate(patch.session_date)) throw new HttpError(400, "날짜가 올바르지 않습니다");
    if ("title" in patch) patch.title = String(patch.title ?? "").trim().slice(0, 60) || null;
    if ("location" in patch) patch.location = String(patch.location ?? "").trim().slice(0, 40) || null;
    if ("description" in patch) patch.description = String(patch.description ?? "").trim().slice(0, 2000) || null;
    if (before.closed_at && Object.keys(patch).some((k) => ["session_date", "start_time", "status"].includes(k))) {
      throw new HttpError(400, "이미 출결이 마감된 모임이라 날짜·시간·상태는 바꿀 수 없어요");
    }
    const t5 = (v: any) => String(v ?? "").slice(0, 5);
    if (["session_date", "start_time"].some((k) => k in patch && t5(patch[k]) !== t5(before[k]))) {
      patch.reminded_72h_at = null; patch.reminded_24h_at = null;   // 시간이 바뀌면 자동 알림을 새 시간 기준으로 다시
    }
    let s = must(await ctx.db.from("meeting_sessions").update(patch).eq("id", before.id).select(SESSION_COLS).single());
    if (patch.status === "취소" && before.status !== "취소") {
      must(await ctx.db.from("checkins").delete().eq("session_id", s.id));
      s = { ...s, checkins: [] };
    } else {
      if ((s.checkins ?? []).length && ("session_date" in patch || "title" in patch)) {
        must(await ctx.db.from("checkins").update({ check_date: s.session_date, title: sessionName(s) }).eq("session_id", s.id));
      }
      // 체크인 항목 고치기: 비우면 체크인을 지우고, 없던 체크인이면 새로 붙임
      if (Array.isArray(ctx.payload.checkin_items)) {
        const items = ["기상", "출발", "도착"].filter((x) => ctx.payload.checkin_items.includes(x));
        const cur: any[] = s.checkins ?? [];
        if (!items.length && cur.length) must(await ctx.db.from("checkins").delete().eq("session_id", s.id));
        else if (items.length && cur.length) {
          for (const c of cur) {
            const gone = (c.items ?? []).filter((x: string) => !items.includes(x));
            if (gone.length) must(await ctx.db.from("checkin_reports").delete().eq("checkin_id", c.id).in("item", gone));
          }
          must(await ctx.db.from("checkins").update({ items }).eq("session_id", s.id));
        } else if (items.length) {
          must(await ctx.db.from("checkins").insert({
            team_id: s.team_id, session_id: s.id, title: sessionName(s), check_date: s.session_date, items,
            target_unit_id: s.target_unit_id, target_people: s.target_people, target_label: s.target_label, created_by: ctx.me.id,
          }));
        }
        s = must(await ctx.db.from("meeting_sessions").select(SESSION_COLS).eq("id", s.id).single());
      }
    }
    let notify = null;
    if (ctx.payload.notify !== false && patch.status === "취소" && before.status !== "취소") {
      notify = await notifyMembers(ctx, s, "cancel");
    } else if (ctx.payload.notify === true) {
      const moved = ["session_date", "start_time", "end_time", "location"].some((k) => k in patch && t5(patch[k]) !== t5(before[k]));
      if (moved) { await rateLimit(ctx, "sess_change", 6, 30); notify = await notifyMembers(ctx, s, "change"); }
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
    // 다른 팀이 만든 모임이라도 내가 대상자로 집혔으면 같이 보여줌 (예: 방송예술과 전체 모임)
    let q2 = ctx.db.from("meeting_sessions").select(SESSION_COLS).neq("team_id", team_id).contains("target_people", [ctx.me.id]);
    if (from) q2 = q2.gte("session_date", from);
    if (to) q2 = q2.lte("session_date", to);
    const [groups, mineElsewhere] = await Promise.all([myGroupIds(ctx), q2]);
    let list: any[] = (must(await q) ?? []).filter((s: any) => visibleToMe(s, rank, groups, ctx.me.id))
      .concat(must(mineElsewhere as any) ?? [])
      .sort((a: any, b: any) => (a.session_date + (a.start_time ?? "")) < (b.session_date + (b.start_time ?? "")) ? -1 : 1);
    list = await autoClose(ctx, list);
    const ids = list.map((s) => s.id);
    const rows: any[] = ids.length ? must(await ctx.db.from("attendance")
      .select("session_id, person_id, planned_status, planned_reason, planned_at, status, reason, reason_at, arrived_at, checked_by")
      .in("session_id", ids)) ?? [] : [];
    // 마감 전 모임의 대상 인원은 지금 팀원 기준으로 셈
    const now = await sessionMembers(ctx, { team_id, session_date: kstToday(), target_unit_id: null });
    return list.map((s) => {
      const rs = rows.filter((r) => r.session_id === s.id);
      const targets = s.closed_at ? null : s.target_people?.length ? s.target_people.map((id: string) => ({ id }))
        : now.filter((m) => !s.target_unit_id || m.group_id === s.target_unit_id);
      const count = (k: string, v: string) => rs.filter((r) => r[k] === v).length;
      const mine = rs.find((r) => r.person_id === ctx.me.id);
      const own = s.team_id === team_id && rank >= RANK.GROUP_LEADER;   // 알림 결과(누가 못 받았는지)는 조장 이상만
      return {
        ...s, notify_result: own ? s.notify_result : null, remind_result: own ? s.remind_result : null,
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
    if (rank < RANK.MEMBER && !inTargets(s, ctx.me.id)) throw new HttpError(403, "권한이 없습니다");
    if (!visibleToMe(s, rank, await myGroupIds(ctx), ctx.me.id)) throw new HttpError(403, "이 모임 대상이 아니에요");
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
      session: { ...s, notify_result: lead ? s.notify_result : null, remind_result: lead ? s.remind_result : null, start_ms: sessionStart(s), end_ms: sessionEnd(s), plan_deadline: planDeadline(s) },
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
    await requireSessionMember(ctx, s);
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
    if (target === ctx.me.id) await requireSessionMember(ctx, s); else await requireRank(ctx, s.team_id, RANK.GROUP_LEADER);
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
      const raw = Array.isArray(input[String(i)]) ? input[String(i)].slice(0, 100) : [];
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

  // 업무 탭 아래 '업무가능 시간 2주 한눈에': 오늘부터 14일, 볼 수 있는 팀(모아보기와 같음: 내가 조장 이상인 팀 + 녹음 관계자면 녹음 팀)
  // → { dates, hours, teams, mine:[내 팀 이름], weeks:[월요일…], people:[{ id, name, teams, group, slots:{날짜번호:[칸]}, weeks:{월요일: 낸 여부}, memo:{월요일: 특이사항} }] }
  async "weekly.overview"(ctx) {
    const teams = await boardTeams(ctx);
    if (!teams.length) throw new HttpError(403, "권한이 없습니다");
    const teamIds = teams.map((t) => t.id);
    const today = kstToday();
    const dates = Array.from({ length: 14 }, (_, i) => addDaysStr(today, i));
    const dow = new Date(today + "T00:00:00Z").getUTCDay();
    const mon = addDaysStr(today, -((dow + 6) % 7));
    const weeks = [mon, addDaysStr(mon, 7), addDaysStr(mon, 14)].filter((w) => w <= dates[13]);
    const pos: any[] = must(await ctx.db.from("position_history").select("person_id, org_unit_id, people(name, is_active)")
      .in("org_unit_id", teamIds).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
    const people = new Map<string, any>();
    for (const p of pos) {
      if (!p.people?.is_active) continue;
      const cur = people.get(p.person_id) ?? { id: p.person_id, name: p.people.name, teams: [] as string[], group: null, slots: {}, weeks: {}, memo: {} };
      const tname = teams.find((t) => t.id === p.org_unit_id)?.name;
      if (tname && !cur.teams.includes(tname)) cur.teams.push(tname);
      people.set(p.person_id, cur);
    }
    const ids = [...people.keys()];
    if (ids.length) {
      const [groups, avail, subs] = await Promise.all([
        ctx.db.from("group_assignments").select("person_id, org_units(name, parent_id)").in("person_id", ids).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`),
        ctx.db.from("availability").select("person_id, avail_date, slots").in("person_id", ids).in("avail_date", dates),
        ctx.db.from("weekly_submissions").select("person_id, week_start, memo").in("person_id", ids).in("week_start", weeks),
      ]);
      for (const g of must(groups as any) ?? []) if (teamIds.includes(g.org_units?.parent_id)) people.get(g.person_id).group = g.org_units.name;
      for (const a of must(avail as any) ?? []) {
        if (!a.slots?.length) continue;
        people.get(a.person_id).slots[String(dates.indexOf(a.avail_date))] = a.slots;
      }
      for (const w of must(subs as any) ?? []) { const p = people.get(w.person_id); p.weeks[w.week_start] = true; if (w.memo) p.memo[w.week_start] = w.memo; }
    }
    const { teams: mineT } = await myTeams(ctx);
    return {
      dates, weeks, hours: await weeklyHours(ctx), teams: teams.map((t) => t.name),
      mine: mineT.filter((t: any) => teamIds.includes(t.id)).map((t: any) => t.name),
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
    const NCOLS = "id, team_id, title, body, target_unit_id, target_positions, target_people, target_label, is_pinned, published_at, created_by";
    const [rows, elsewhere, groups, posRes] = await Promise.all([
      ctx.db.from("notices").select(NCOLS)
        .in("team_id", units).order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(60),
      // 다른 팀이 쓴 공지라도 내가 받는 사람으로 집혔으면
      ctx.db.from("notices").select(NCOLS).not("team_id", "in", `(${units.join(",")})`).contains("target_people", [ctx.me.id])
        .order("published_at", { ascending: false }).limit(30),
      myGroupIds(ctx),
      ctx.db.from("positions").select("code, name, rank"),
    ]);
    const pos = new Map((must(posRes as any) ?? []).map((p: any) => [p.code, p]));
    // 직책을 콕 집은 공지: 그 직책인 사람 + 쓴 사람 + 관리하는 사람(팀 공지는 교관 이상, 과 공지는 팀장 이상)
    const forMe = (r: any) => r.target_people?.length
      ? r.target_people.includes(ctx.me.id) || r.created_by === ctx.me.id || rank >= (r.team_id === team_id ? RANK.INSTRUCTOR : RANK.TEAM_LEADER)
      : !r.target_positions?.length || r.created_by === ctx.me.id ||
      rank >= (r.team_id === team_id ? RANK.INSTRUCTOR : RANK.TEAM_LEADER) ||
      r.target_positions.some((c: string) => (pos.get(c) as any)?.rank === rank);
    const mine = new Set((must(rows as any) ?? []).map((r: any) => r.id));
    const list = (must(rows as any) ?? []).filter((r: any) => (r.target_people?.length || visibleToMe(r, rank, groups)) && forMe(r))
      .concat((must(elsewhere as any) ?? []).filter((r: any) => !mine.has(r.id)))
      .sort((a: any, b: any) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || (a.published_at < b.published_at ? 1 : -1));
    const [names, { counts, seen }] = await Promise.all([nameMap(ctx, list.map((r: any) => r.created_by)), readCounts(ctx, "notice", list)]);
    // 확인 명단은 쓴 사람, 팀 공지는 교관 이상, 과 공지는 팀장 이상
    const canSee = (r: any) => r.created_by === ctx.me.id || rank >= (r.team_id === team_id ? RANK.INSTRUCTOR : RANK.TEAM_LEADER);
    return list.map((r: any) => ({
      ...r, scope: r.team_id === team_id ? "team" : units.includes(r.team_id) ? "section" : "other",
      target_names: (r.target_positions ?? []).map((c: string) => (pos.get(c) as any)?.name).filter(Boolean),
      author: names.get(r.created_by) ?? null, mine: r.created_by === ctx.me.id,
      read_count: canSee(r) ? counts.get(r.id) ?? 0 : null, seen: seen.has(r.id) || r.created_by === ctx.me.id,
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
    const target_people = await pickedPeople(ctx, p, RANK.INSTRUCTOR, RANK.TEAM_LEADER);
    if (!section && !target_people) await checkGroup(ctx, p.team_id, p.target_unit_id);
    const codes = !target_people && Array.isArray(p.target_positions) ? [...new Set(p.target_positions.map(String))] : [];
    if (codes.length) {
      const ok: any[] = must(await ctx.db.from("positions").select("code").in("code", codes)) ?? [];
      if (ok.length !== codes.length) throw new HttpError(400, "직책이 올바르지 않습니다");
    }
    return must(await ctx.db.from("notices").insert({
      team_id: unit, title, body: String(p.body ?? "").trim().slice(0, 3000) || null,
      is_pinned: !!p.is_pinned, target_unit_id: section || target_people ? null : (p.target_unit_id || null),
      target_positions: codes.length ? codes : null, target_people, target_label: target_people ? labelOf(p) : null,
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
    if ("title" in patch) { patch.title = String(patch.title ?? "").trim().slice(0, 100); if (!patch.title) throw new HttpError(400, "제목을 입력해주세요"); }
    if ("body" in patch) patch.body = String(patch.body ?? "").trim().slice(0, 3000) || null;
    if ("is_pinned" in patch) patch.is_pinned = !!patch.is_pinned;
    return must(await ctx.db.from("notices").update(patch).eq("id", row.id).select().single());
  },
  async "notices.delete"(ctx) {
    const row = await editableNotice(ctx, ctx.payload.id);
    must(await ctx.db.from("notices").delete().eq("id", row.id));
    await ctx.db.from("content_reads").delete().eq("kind", "notice").eq("item_id", row.id);
    return { ok: true };
  },

  // 생일 축하 메시지: { team_id, person_id, message } → 같은 과 사람, 오늘 생일일 때만, 한 사람에게 그해 한 번. 봇으로 바로 전달
  async "birthday.wish"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.MEMBER);
    const message = String(p.message ?? "").trim().slice(0, 300);
    if (!message) throw new HttpError(400, "축하 메시지를 적어주세요");
    if (p.person_id === ctx.me.id) throw new HttpError(400, "내 생일엔 축하를 받기만 해요 🎂");
    const units = await sectionUnits(ctx, p.team_id);
    const target = (await unitMembers(ctx, units)).find((m) => m.id === p.person_id);
    const today = kstToday(), year = +today.slice(0, 4);
    if (!target?.birth_date || bdayMd(target.birth_date, year) !== today.slice(5)) throw new HttpError(400, "오늘 생일인 사람에게만 보낼 수 있어요");
    const ins = await ctx.db.from("birthday_wishes").insert({ person_id: target.id, year, from_id: ctx.me.id, message }).select("id").single();
    if (ins.error?.code === "23505") throw new HttpError(409, "이미 축하 메시지를 보냈어요");
    must(ins);
    const text = `<b>🎂 ${escHtml(ctx.me.name)}님이 생일 축하 메시지를 보냈어요</b>\n\n${escHtml(message)}`;
    const { sent } = await sendToMembers([target], text, { inline_keyboard: [[{ text: "방송예술과 열기", web_app: { url: MINIAPP_URL } }]] });
    if (sent) await ctx.db.from("birthday_wishes").update({ delivered: true }).eq("id", ins.data.id);
    return { delivered: !!sent };
  },

  // 확인 기록 남기기 (공지를 펼치거나 과제를 열 때): { kind: notice|assignment, id }
  async "reads.mark"(ctx) {
    const { kind, id } = ctx.payload;
    const t = await readTarget(ctx, kind, id);
    if (t.rank < RANK.MEMBER && !t.inTarget) throw new HttpError(403, "권한이 없습니다");
    must(await ctx.db.from("content_reads").upsert(
      { kind, item_id: id, person_id: ctx.me.id, last_read_at: new Date().toISOString() },
      { onConflict: "kind,item_id,person_id" }));
    return { ok: true };
  },
  // 확인한 사람 / 아직 안 본 사람: { kind, id } → 쓴 사람, 공지는 교관(과 공지 팀장) 이상, 과제는 조장 이상
  async "reads.list"(ctx) {
    const { kind, id } = ctx.payload;
    const t = await readTarget(ctx, kind, id);
    if (!t.canSee) throw new HttpError(403, "확인 명단은 쓴 사람이나 관리하는 사람만 볼 수 있어요");
    const [aud, rows] = await Promise.all([
      t.audience(),
      ctx.db.from("content_reads").select("person_id, first_read_at, last_read_at").eq("kind", kind).eq("item_id", id),
    ]);
    const byPerson = new Map((must(rows as any) ?? []).map((r: any) => [r.person_id, r]));
    const view = (m: any) => ({ id: m.id, name: m.name, position: m.position, group: m.group });
    const read = aud.filter((m: any) => byPerson.has(m.id)).map((m: any) => ({ ...view(m), at: (byPerson.get(m.id) as any).first_read_at }))
      .sort((a: any, b: any) => a.at < b.at ? -1 : 1);
    const unread = aud.filter((m: any) => !byPerson.has(m.id)).map(view);
    return { total: aud.length, read, unread };
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
    const [rows, elsewhere, groups] = await Promise.all([
      ctx.db.from("assignments").select("*").eq("team_id", team_id)
        .or(`due_at.is.null,due_at.gte.${since}`).order("created_at", { ascending: false }).limit(60),
      ctx.db.from("assignments").select("*").neq("team_id", team_id).contains("target_people", [ctx.me.id])
        .or(`due_at.is.null,due_at.gte.${since}`).order("created_at", { ascending: false }).limit(30),
      myGroupIds(ctx),
    ]);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups, ctx.me.id))
      .concat(must(elsewhere as any) ?? []);
    const ids = list.map((a: any) => a.id);
    let subs: any[] = [];
    if (ids.length) {
      let q = ctx.db.from("assignment_submissions").select("id, assignment_id, person_id, content, file_url, submitted_at, feedback, feedback_at").in("assignment_id", ids);
      if (rank < RANK.GROUP_LEADER) q = q.eq("person_id", ctx.me.id);
      subs = must(await q) ?? [];
    }
    const { counts, seen } = await readCounts(ctx, "assignment", list);
    return list.map((a: any) => ({
      ...a,
      my: subs.find((s) => s.assignment_id === a.id && s.person_id === ctx.me.id) ?? null,
      submitted_count: rank >= RANK.GROUP_LEADER ? subs.filter((s) => s.assignment_id === a.id).length : null,
      read_count: rank >= RANK.GROUP_LEADER || a.created_by === ctx.me.id ? counts.get(a.id) ?? 0 : null,
      seen: seen.has(a.id) || a.created_by === ctx.me.id,
    }));
  },

  // 과제 내기: { team_id, category?, title, description?, starts_on?, due_at?, needs_feedback?, target_unit_id? } → 교관 이상
  async "assignments.create"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    const title = String(p.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(400, "과제 제목을 입력해주세요");
    const target_people = await pickedPeople(ctx, p, RANK.INSTRUCTOR, RANK.TEAM_LEADER);
    if (!target_people) await checkGroup(ctx, p.team_id, p.target_unit_id);
    return must(await ctx.db.from("assignments").insert({
      ...pick(p, ["starts_on", "due_at", "target_unit_id"]),
      category: String(p.category ?? "").trim().slice(0, 20) || null, description: String(p.description ?? "").trim().slice(0, 3000) || null,
      needs_feedback: p.needs_feedback !== false,
      ...(target_people ? { target_unit_id: null } : {}), target_people, target_label: target_people ? labelOf(p) : null,
      title, team_id: p.team_id, created_by: ctx.me.id,
    }).select().single());
  },
  async "assignments.update"(ctx) {
    const team = await ownerTeam(ctx, "assignments", ctx.payload.id);
    await requireRank(ctx, team, RANK.INSTRUCTOR);
    const patch = pick(ctx.payload, ["category", "title", "description", "starts_on", "due_at", "needs_feedback", "target_unit_id"]);
    if ("title" in patch) { patch.title = String(patch.title ?? "").trim().slice(0, 100); if (!patch.title) throw new HttpError(400, "과제 제목을 입력해주세요"); }
    if ("category" in patch) patch.category = String(patch.category ?? "").trim().slice(0, 20) || null;
    if ("description" in patch) patch.description = String(patch.description ?? "").trim().slice(0, 3000) || null;
    if ("needs_feedback" in patch) patch.needs_feedback = !!patch.needs_feedback;
    if ("target_unit_id" in patch) patch.target_unit_id = await checkGroup(ctx, team, patch.target_unit_id);
    return must(await ctx.db.from("assignments").update(patch).eq("id", ctx.payload.id).select().single());
  },
  async "assignments.delete"(ctx) {
    await requireRank(ctx, await ownerTeam(ctx, "assignments", ctx.payload.id), RANK.INSTRUCTOR);
    must(await ctx.db.from("assignments").delete().eq("id", ctx.payload.id));
    await ctx.db.from("content_reads").delete().eq("kind", "assignment").eq("item_id", ctx.payload.id);
    return { ok: true };
  },

  // 내 과제 제출·수정: { assignment_id, content?, file_url? }
  async "submissions.saveMine"(ctx) {
    const p = ctx.payload;
    const row = must(await ctx.db.from("assignments").select("team_id, target_people, target_unit_id").eq("id", p.assignment_id).maybeSingle());
    if (!row) throw new HttpError(404, "과제를 찾을 수 없습니다");
    await requireItemTarget(ctx, row);
    const content = String(p.content ?? "").trim().slice(0, 5000) || null;
    const file_url = String(p.file_url ?? "").trim().slice(0, 500) || null;
    if (file_url && !/^https?:\/\//i.test(file_url)) throw new HttpError(400, "링크는 http:// 또는 https:// 로 시작해야 해요");
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
    const [rows, elsewhere, groups] = await Promise.all([
      ctx.db.from("checkins").select("*").eq("team_id", team_id)
        .gte("check_date", addDaysStr(today, -7)).lte("check_date", addDaysStr(today, 30))
        .order("check_date", { ascending: false }),
      ctx.db.from("checkins").select("*").neq("team_id", team_id).contains("target_people", [ctx.me.id])
        .gte("check_date", addDaysStr(today, -7)).lte("check_date", addDaysStr(today, 30)),
      myGroupIds(ctx),
    ]);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups, ctx.me.id))
      .concat(must(elsewhere as any) ?? []).sort((a: any, b: any) => a.check_date < b.check_date ? 1 : -1);
    const ids = list.map((c: any) => c.id);
    let reps: any[] = [];
    if (ids.length) {
      let q = ctx.db.from("checkin_reports").select("checkin_id, person_id, item, reported_at, note, fixed_at").in("checkin_id", ids);
      if (rank < RANK.GROUP_LEADER) q = q.eq("person_id", ctx.me.id);
      reps = must(await q) ?? [];
    }
    const names = rank >= RANK.GROUP_LEADER ? await nameMap(ctx, reps.map((r) => r.person_id)) : new Map();
    return list.map((c: any) => {
      const mine: Record<string, any> = {};
      for (const r of reps) if (r.checkin_id === c.id && r.person_id === ctx.me.id) mine[r.item] = { at: r.reported_at, note: r.note, fixed: !!r.fixed_at };
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
    if (!isDate(p.check_date)) throw new HttpError(400, "날짜를 골라주세요");
    const items = (Array.isArray(p.items) ? p.items : []).filter((x: any) => ["기상", "출발", "도착"].includes(x));
    if (!items.length) throw new HttpError(400, "받을 항목을 하나 이상 골라주세요");
    const target_people = await pickedPeople(ctx, p, RANK.INSTRUCTOR, RANK.TEAM_LEADER);
    if (!target_people) await checkGroup(ctx, p.team_id, p.target_unit_id);
    if (p.session_id) {
      const ss = must(await ctx.db.from("meeting_sessions").select("team_id").eq("id", p.session_id).maybeSingle());
      if (!ss || ss.team_id !== p.team_id) throw new HttpError(400, "이 팀의 모임이 아닙니다");
    }
    return must(await ctx.db.from("checkins").insert({
      team_id: p.team_id, title, check_date: p.check_date, items,
      target_unit_id: target_people ? null : p.target_unit_id || null, target_people, target_label: target_people ? labelOf(p) : null, session_id: p.session_id || null, created_by: ctx.me.id,
    }).select().single());
  },
  // 체크인 고치기: { id, title?, check_date?, items? } → 만든 사람 또는 그 팀 교관 이상. 모임에 붙은 체크인은 날짜를 모임이 정함
  async "checkins.update"(ctx) {
    const c = must(await ctx.db.from("checkins").select("id, team_id, created_by, session_id, items").eq("id", ctx.payload.id).maybeSingle());
    if (!c) throw new HttpError(404, "체크인을 찾을 수 없습니다");
    if (c.created_by !== ctx.me.id) await requireRank(ctx, c.team_id, RANK.INSTRUCTOR);
    const patch: any = {};
    if ("title" in ctx.payload) { patch.title = String(ctx.payload.title ?? "").trim().slice(0, 60); if (!patch.title) throw new HttpError(400, "제목을 입력해주세요"); }
    if ("check_date" in ctx.payload && !c.session_id) { if (!isDate(ctx.payload.check_date)) throw new HttpError(400, "날짜를 골라주세요"); patch.check_date = ctx.payload.check_date; }
    if ("items" in ctx.payload) {
      patch.items = ["기상", "출발", "도착"].filter((x) => Array.isArray(ctx.payload.items) && ctx.payload.items.includes(x));
      if (!patch.items.length) throw new HttpError(400, "받을 항목을 하나 이상 골라주세요");
      // 뺀 항목의 보고 기록은 지움
      const gone = (c.items ?? []).filter((x: string) => !patch.items.includes(x));
      if (gone.length) must(await ctx.db.from("checkin_reports").delete().eq("checkin_id", c.id).in("item", gone));
    }
    return must(await ctx.db.from("checkins").update(patch).eq("id", c.id).select().single());
  },
  async "checkins.delete"(ctx) {
    await requireRank(ctx, await ownerTeam(ctx, "checkins", ctx.payload.id), RANK.INSTRUCTOR);
    must(await ctx.db.from("checkins").delete().eq("id", ctx.payload.id));
    return { ok: true };
  },

  // 체크인 보고: { checkin_id, item, note?(도착 예정 등) } / 잘못 눌렀을 때 취소: checkins.unreport
  async "checkins.report"(ctx) {
    const c = must(await ctx.db.from("checkins").select("team_id, items, target_people, target_unit_id, check_date").eq("id", ctx.payload.checkin_id).maybeSingle());
    if (!c) throw new HttpError(404, "체크인을 찾을 수 없습니다");
    await requireItemTarget(ctx, c);
    if (!c.items.includes(ctx.payload.item)) throw new HttpError(400, "이 체크인에 없는 항목입니다");
    // 시간 고치기 { at: "HH:MM" }: 잘못 눌렀을 때 본인이 실제 시각으로 (그 체크인 날짜, 지금보다 늦게는 안 됨). 고친 표시 fixed_at
    const row: any = { checkin_id: ctx.payload.checkin_id, person_id: ctx.me.id, item: ctx.payload.item, reported_at: new Date().toISOString() };
    if (ctx.payload.at !== undefined) {
      const hm = parseHm(String(ctx.payload.at));
      if (!hm) throw new HttpError(400, "시간을 19:00처럼 적어주세요");
      const at = kstMs(c.check_date, hm + ":00");
      if (at > Date.now() + 5 * 60000) throw new HttpError(400, "지금보다 늦은 시간으로는 고칠 수 없어요");
      row.reported_at = new Date(at).toISOString(); row.fixed_at = new Date().toISOString();
    } else row.note = String(ctx.payload.note ?? "").trim().slice(0, 100) || null;
    return must(await ctx.db.from("checkin_reports").upsert(row, { onConflict: "checkin_id,person_id,item" }).select().single());
  },
  async "checkins.unreport"(ctx) {
    must(await ctx.db.from("checkin_reports").delete()
      .eq("checkin_id", ctx.payload.checkin_id).eq("person_id", ctx.me.id).eq("item", ctx.payload.item));
    return { ok: true };
  },

  // ----- 시간취합 (누구나 만들고, 대상자가 가능한 30분 칸을 칠함) -----
  // 내가 만들었거나 대상인 취합: 진행 중 + 마감 7일 안
  async "polls.list"(ctx) {
    const me = ctx.me.id, since = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    const [a, b] = await Promise.all([
      ctx.db.from("time_polls").select("*").eq("created_by", me).neq("status", "취소").gte("deadline", since),
      ctx.db.from("time_polls").select("*").contains("target_people", [me]).neq("status", "취소").gte("deadline", since),
    ]);
    const map = new Map<string, any>();
    for (const p of [...(must(a as any) ?? []), ...(must(b as any) ?? [])]) map.set(p.id, p);
    const list = [...map.values()];
    const ids = list.map((p) => p.id);
    const ans: any[] = ids.length ? must(await ctx.db.from("time_poll_answers").select("poll_id, person_id").in("poll_id", ids)) ?? [] : [];
    const owners = await nameMap(ctx, list.map((p) => p.created_by));
    return list.map((p) => {
      const mine = ans.filter((x) => x.poll_id === p.id);
      return {
        id: p.id, title: p.title, start_date: p.start_date, end_date: p.end_date, deadline: p.deadline, target_label: p.target_label,
        owner: owners.get(p.created_by) ?? "", is_mine: p.created_by === me, is_target: (p.target_people ?? []).includes(me),
        open: pollOpen(p), status: p.status, count: (p.target_people ?? []).length,
        responded: mine.filter((x) => (p.target_people ?? []).includes(x.person_id)).length,
        answered: mine.some((x) => x.person_id === me),
      };
    }).sort((x, y) => Number(y.open) - Number(x.open) || (x.open ? Date.parse(x.deadline) - Date.parse(y.deadline) : Date.parse(y.deadline) - Date.parse(x.deadline)));
  },

  // 취합 하나: 날짜·시간대, 대상자(응답 여부·특이사항), 사람마다 칠한 칸, 내 칸, 내 고정 일정(음영용)
  async "polls.get"(ctx) {
    const p = await pollRow(ctx, ctx.payload.id);
    const [ans, fixed] = await Promise.all([
      ctx.db.from("time_poll_answers").select("person_id, slots, memo, updated_at").eq("poll_id", p.id),
      ctx.db.from("fixed_schedules").select("title, weekday, start_time, end_time").eq("person_id", ctx.me.id),
    ]);
    const answers: any[] = must(ans as any) ?? [];
    const names = await nameMap(ctx, [...(p.target_people ?? []), p.created_by]);
    const byPerson = new Map(answers.map((a) => [a.person_id, a]));
    const mine = byPerson.get(ctx.me.id);
    return {
      id: p.id, title: p.title, dates: pollDates(p), hour_from: p.hour_from, hour_to: p.hour_to, deadline: p.deadline,
      status: p.status, open: pollOpen(p), target_label: p.target_label, created_at: p.created_at,
      owner: names.get(p.created_by) ?? "", is_mine: p.created_by === ctx.me.id, is_target: (p.target_people ?? []).includes(ctx.me.id),
      people: (p.target_people ?? []).map((id: string) => {
        const a = byPerson.get(id);
        return { id, name: names.get(id) ?? "", answered: !!a, memo: a?.memo ?? "", slots: a?.slots ?? [] };
      }).sort((x: any, y: any) => x.name.localeCompare(y.name)),
      mine: { slots: mine?.slots ?? [], memo: mine?.memo ?? "", answered: !!mine, at: mine?.updated_at ?? null },
      fixed: must(fixed as any) ?? [],
      reminded_at: p.reminded_at,
    };
  },

  // 만들기: { team_id, scope, target_people, target_label, title, start_date, end_date, hour_from, hour_to, deadline:"YYYY-MM-DDTHH:MM"(한국 시간) }
  // 과 사람 누구나. 만든 사람도 대상에 들어감. 대상자에게 봇 알림
  async "polls.create"(ctx) {
    const p = ctx.payload;
    const title = String(p.title ?? "").trim().slice(0, 80);
    if (!title) throw new HttpError(400, "무엇을 정하는지 주제를 적어주세요");
    if (!Array.isArray(p.target_people)) throw new HttpError(400, "대상자를 골라주세요");
    const picked = (await pickedPeople(ctx, p, RANK.MEMBER, RANK.MEMBER))!;
    const targets = [...new Set([ctx.me.id, ...picked])];
    if (targets.length < 2) throw new HttpError(400, "나 말고 대상자를 한 명 이상 골라주세요");
    if (targets.length > 200) throw new HttpError(400, "대상이 너무 많아요");
    if (!isDate(p.start_date) || !isDate(p.end_date)) throw new HttpError(400, "후보 날짜를 골라주세요");
    const today = kstToday();
    if (p.start_date < today) throw new HttpError(400, "후보 날짜는 오늘부터 고를 수 있어요");
    if (p.end_date < p.start_date) throw new HttpError(400, "끝 날짜가 시작 날짜보다 빨라요");
    if (addDaysStr(p.start_date, POLL_MAX_DAYS - 1) < p.end_date) throw new HttpError(400, `후보 날짜는 ${POLL_MAX_DAYS}일 안으로 골라주세요`);
    const h0 = Number(p.hour_from), h1 = Number(p.hour_to);
    if (!(Number.isInteger(h0) && Number.isInteger(h1) && h0 >= 0 && h1 <= 24 && h0 < h1)) throw new HttpError(400, "시간대를 확인해주세요");
    const m = String(p.deadline ?? "").match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)$/);
    if (!m) throw new HttpError(400, "마감 시각을 골라주세요");
    const due = kstMs(m[1], m[2]);
    if (!(due > Date.now())) throw new HttpError(400, "마감은 지금 이후로 골라주세요");
    if (due > Date.now() + 60 * 24 * HOUR) throw new HttpError(400, "마감은 두 달 안으로 골라주세요");
    await rateLimit(ctx, "poll_new", 5, 24 * 60);
    const row = must(await ctx.db.from("time_polls").insert({
      team_id: p.team_id, title, start_date: p.start_date, end_date: p.end_date, hour_from: h0, hour_to: h1,
      deadline: new Date(due).toISOString(), target_people: targets, target_label: labelOf(p), created_by: ctx.me.id,
    }).select().single());
    const others = await withTelegram(ctx, targets.filter((id) => id !== ctx.me.id));
    const text = `<b>📅 가능시간 취합</b>\n\n「${escHtml(title)}」\n${escHtml(ctx.me.name)}님이 가능한 시간을 여쭤요.\n` +
      `${mdLabel(p.start_date)}${p.end_date !== p.start_date ? " ~ " + mdLabel(p.end_date) : ""} · ${h0}시~${h1}시\n마감 ${msLabel(due)}`;
    const r = await sendToMembers(others, text, pollButton(row.id));
    return { id: row.id, count: targets.length, sent: r.sent, failed: r.failed };
  },

  // 내 가능시간 저장: { id, slots: [칸번호…], memo }
  async "polls.save"(ctx) {
    const p = await pollRow(ctx, ctx.payload.id);
    if (!(p.target_people ?? []).includes(ctx.me.id)) throw new HttpError(403, "이 시간취합의 대상이 아니에요");
    if (!pollOpen(p)) throw new HttpError(409, "마감된 시간취합이에요");
    const days = pollDates(p).length;
    const raw = Array.isArray(ctx.payload.slots) ? ctx.payload.slots.slice(0, days * 48) : [];
    const slots = [...new Set(raw.map((x: any) => Number(x)))].filter((k: any) => {
      if (!Number.isInteger(k)) return false;
      const di = Math.floor(k / 48), s = k % 48;
      return di >= 0 && di < days && s >= p.hour_from * 2 && s < p.hour_to * 2;
    }).sort((a: any, b: any) => a - b) as number[];
    const memo = String(ctx.payload.memo ?? "").trim().slice(0, 200) || null;
    must(await ctx.db.from("time_poll_answers").upsert({ poll_id: p.id, person_id: ctx.me.id, slots, memo }, { onConflict: "poll_id,person_id" }));
    return { count: slots.length };
  },

  // 만든 사람: 일찍 마감(결과 알림은 안 보냄) / 아직 안 한 사람에게 다시 알림(10분에 한 번) / 지우기
  async "polls.close"(ctx) {
    const p = await pollRow(ctx, ctx.payload.id);
    if (p.created_by !== ctx.me.id) throw new HttpError(403, "만든 사람만 마감할 수 있어요");
    must(await ctx.db.from("time_polls").update({ status: "마감", closed_at: new Date().toISOString() }).eq("id", p.id));
    return { ok: true };
  },
  async "polls.remind"(ctx) {
    const p = await pollRow(ctx, ctx.payload.id);
    if (p.created_by !== ctx.me.id) throw new HttpError(403, "만든 사람만 알림을 보낼 수 있어요");
    if (!pollOpen(p)) throw new HttpError(409, "마감된 시간취합이에요");
    await rateLimit(ctx, "poll_remind:" + p.id, 1, 10);
    return await pollRemind(ctx, p, `<b>🔔 ${escHtml(ctx.me.name)}님이 가능시간 입력을 기다려요</b>`);
  },
  async "polls.delete"(ctx) {
    const p = await pollRow(ctx, ctx.payload.id);
    if (p.created_by !== ctx.me.id) throw new HttpError(403, "만든 사람만 지울 수 있어요");
    must(await ctx.db.from("time_polls").delete().eq("id", p.id));
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
    const birthdays = await birthdayInfo(ctx, unitIds).catch((e) => { console.error("birthday", e); return null; });

    // 오늘의 트랙(오늘 하루) + 우리는 준비 중(지금부터 30일) — 모임·녹음·업무·사명자 일정을 한 모양으로
    const sec = { sectionId, kids, teamIds, unitIds, unitName };
    const canDetail = await canSeeDetail(ctx, teamIds);
    const dayStart = kstMs(todayK);
    const [todayItems, ahead, teamCounts] = await Promise.all([
      sectionItems(ctx, sec, dayStart, dayStart + DAY, canDetail),
      sectionItems(ctx, sec, now, now + 30 * DAY, canDetail),
      teamHeadcounts(ctx, kids),
    ]);
    const upcoming = ahead.filter((t: any) => t.start > now).slice(0, 40);
    return {
      schedules, tasksNow, tasksUpcoming, projects, birthdays,
      track: { date: todayK, items: todayItems }, upcoming, teamCounts,
      teams: kids.map((k) => k.name),
      tribes: { list: tribeList, total, filled },
      weekly: {
        this: { week_start: thisMon, submitted: done.has(thisMon) },
        next: { week_start: nextMon, submitted: done.has(nextMon), due: kstMs(addDaysStr(nextMon, -1), "22:00:00") },
        isSunday: dow === 0,
      },
    };
  },

  // ----- 녹음 요청 (세 팀 교관 이상이 함께 봄) -----
  // { team_id } → 과의 녹음 요청 (진행 중 전부 + 지난 60일) + 배역 + 회차(사람·응답)
  async "rec.list"(ctx) {
    const sec = await recSection(ctx, ctx.payload.team_id);
    // 내 소속팀의 업무만 (2026-10-05): 내 팀이 올린 요청 + 내가 올렸거나 사람으로 들어간 요청
    const myTeamIds = new Set((await myTeams(ctx)).teams.filter((t: any) => t.rank >= RANK.MEMBER).map((t: any) => t.id));
    const mineIn: any[] = must(await ctx.db.from("recording_participants").select("recording_sessions!inner(request_id)").eq("person_id", ctx.me.id)) ?? [];
    const joined = new Set(mineIn.map((x) => x.recording_sessions?.request_id).filter(Boolean));
    const rows: any[] = (must(await ctx.db.from("recording_requests")
      .select("id, team_id, title, request_code, request_dept, requester_name, volume_desc, note, due_at, duration_min, voices_needed, status, received_by, received_at, notify_result")
      .in("team_id", sec.teamIds).order("received_at", { ascending: false }).limit(300)) ?? [])
      .filter((r: any) => myTeamIds.has(r.team_id) || r.received_by === ctx.me.id || joined.has(r.id));
    const old = Date.now() - 60 * 86400000;
    const list = rows.filter((r) => !["녹음완료", "편집완료", "전달완료", "취소"].includes(r.status) || Date.parse(r.received_at) >= old);
    const ids = list.map((r) => r.id);
    const [rl, ss] = ids.length ? await Promise.all([
      ctx.db.from("recording_roles").select("id, request_id, name, sort_order, session_id, pref_method, pref_people").in("request_id", ids).order("sort_order"),
      ctx.db.from("recording_sessions").select("id, request_id, title, scheduled_start, scheduled_end, location, status, created_by, confirmed_at, started_at, ended_at, recording_participants(*)")
        .in("request_id", ids).neq("status", "취소").order("scheduled_start"),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const roles: any[] = must(rl as any) ?? [], sess: any[] = must(ss as any) ?? [];
    const names = await nameMap(ctx, [...list.map((r) => r.received_by), ...sess.map((s) => s.created_by),
      ...sess.flatMap((s) => (s.recording_participants ?? []).map((p: any) => p.person_id))]);
    const people = (await recPeople(ctx, sec)).map((m: any) => ({ id: m.id, name: m.name, team: m.team, position: m.position, voice: m.voice, engineer: m.engineer, director: m.director }));
    const requests = list.map((r) => ({
      ...r, received_by_name: names.get(r.received_by) ?? "",
      roles: roles.filter((x) => x.request_id === r.id).map((x) => ({ id: x.id, name: x.name, session_id: x.session_id, pref_method: x.pref_method, pref_people: x.pref_people ?? [] })),
      sessions: sess.filter((s) => s.request_id === r.id).map((s) => ({
        id: s.id, title: s.title ?? "", start: Date.parse(s.scheduled_start), end: s.scheduled_end ? Date.parse(s.scheduled_end) : null,
        location: s.location ?? "", status: s.status, by: names.get(s.created_by) ?? "", confirmed_at: s.confirmed_at, started_at: s.started_at, ended_at: s.ended_at,
        people: (s.recording_participants ?? []).map((p: any) => ({
          id: p.id, person_id: p.person_id, name: names.get(p.person_id) ?? "", role: p.role, role_id: p.role_id, method: p.method,
          answer: p.answer, note: p.answer_note ?? "", answered_at: p.answered_at, selected: p.selected, seen_at: p.seen_at, arrived_at: p.arrived_at, notified_at: p.notified_at,
          from: p.starts_at ? Date.parse(p.starts_at) : null, to: p.ends_at ? Date.parse(p.ends_at) : null,
        })),
      })),
    }));
    return { requests, people };
  },

  // 녹음 요청 받기: { team_id, title, due_at, duration_min, roles:[배역 이름…], request_dept?, requester_name?, volume_desc?, note? }
  // 요청 코드는 자동(R+연월일-순번). 세 팀 교관 이상 모두에게 봇 알림 (내 업무가 아니어도 공유)
  async "rec.create"(ctx) {
    const p = ctx.payload;
    const sec = await recSection(ctx, p.team_id);
    if (!sec.teamIds.includes(p.team_id)) throw new HttpError(400, "팀이 올바르지 않습니다");
    const title = String(p.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(400, "녹음 제목을 적어주세요");
    const due = Date.parse(p.due_at ?? "");
    if (!due) throw new HttpError(400, "마감 기한을 넣어주세요");
    const dur = [10, 30, 60, 90, 120].includes(Number(p.duration_min)) ? Number(p.duration_min) : 60;
    // 배역: [{ name, method?: 지정|후보, people?: [id] }] (문자열만 와도 됨)
    const rawRoles: any[] = (Array.isArray(p.roles) ? p.roles : []).slice(0, 30).map((x: any) => (typeof x === "string" ? { name: x } : x ?? {}));
    const nRoles = Math.max(1, rawRoles.length);
    const names = Array.from({ length: nRoles }, (_, i) => String(rawRoles[i]?.name ?? "").trim().slice(0, 40) || (nRoles === 1 ? "성우" : `배역${i + 1}`));
    const voices = new Set((await recPeople(ctx, sec)).filter((m: any) => m.voice).map((m: any) => m.id));
    const prefs = Array.from({ length: nRoles }, (_, i) => {
      const r = rawRoles[i] ?? {}, method = ["지정", "후보"].includes(r.method) ? r.method : null;
      const ppl = [...new Set((Array.isArray(r.people) ? r.people : []).map(String))].filter((id) => voices.has(id)).slice(0, 5) as string[];
      if (!method || !ppl.length) return { pref_method: null, pref_people: [] };
      if (method === "지정" && ppl.length !== 1) throw new HttpError(400, `'${names[i]}' 배역은 지정이라 한 명만 골라주세요`);
      return { pref_method: method, pref_people: ppl };
    });
    const txt = (v: any, n: number) => String(v ?? "").trim().slice(0, n) || null;
    await rateLimit(ctx, "rec_new", 6, 30);
    const prefix = "R" + kstToday().slice(2).replace(/-/g, "");
    let row: any = null;
    for (let tries = 0; tries < 3 && !row; tries++) {
      const { count } = await ctx.db.from("recording_requests").select("id", { count: "exact", head: true }).like("request_code", prefix + "-%");
      const code = `${prefix}-${String((count ?? 0) + 1 + tries).padStart(2, "0")}`;
      const ins = await ctx.db.from("recording_requests").insert({
        team_id: p.team_id, title, request_code: code, request_dept: txt(p.request_dept, 60),
        requester_name: txt(p.requester_name, 40), volume_desc: txt(p.volume_desc, 300), note: txt(p.note, 1000),
        due_at: new Date(due).toISOString(), duration_min: dur, voices_needed: nRoles, received_by: ctx.me.id, status: "접수",
      }).select("*").single();
      if (ins.error?.code === "23505") continue;
      row = must(ins);
    }
    if (!row) throw new HttpError(409, "요청 코드를 만들지 못했어요. 다시 시도해주세요");
    const roles = must(await ctx.db.from("recording_roles").insert(names.map((n, i) => ({ request_id: row.id, name: n, sort_order: i, ...prefs[i] })))
      .select("id, name, session_id, pref_method, pref_people")) ?? [];

    const staff = (await recPeople(ctx, sec)).filter((m: any) => m.rank >= RANK.INSTRUCTOR && m.id !== ctx.me.id);
    const text = [
      `🎙 <b>새 녹음 요청</b>`,
      `<b>${escHtml(title)}</b> · ${escHtml(row.request_code)}`,
      `마감 ${msLabel(due)}`,
      [row.request_dept, row.requester_name].filter(Boolean).length ? `요청 ${escHtml([row.request_dept, row.requester_name].filter(Boolean).join(" · "))}` : "",
      row.volume_desc ? `분량 ${escHtml(row.volume_desc)}` : "",
      `배역 ${escHtml(names.join(", "))} · 예상 ${dur === 10 ? "10분 내외" : dur >= 120 ? "2시간 이상" : dur % 60 ? (dur / 60).toFixed(1) + "시간" : dur / 60 + "시간"}`,
      `접수 ${escHtml(ctx.me.name)}`,
    ].filter(Boolean).join("\n");
    const notify = await sendToMembers(await withTelegram(ctx, staff.map((m: any) => m.id)), text, recButton(row.id));
    const result = { at: new Date().toISOString(), sent: notify.sent, failed: notify.failed, why: notify.why };
    await ctx.db.from("recording_requests").update({ notify_result: result }).eq("id", row.id);
    return { ...row, notify_result: result, received_by_name: ctx.me.name, roles, sessions: [] };
  },

  // 고치기·상태 바꾸기: { id, title?, due_at?, duration_min?, request_dept?, requester_name?, volume_desc?, note?, status? }
  async "rec.update"(ctx) {
    const p = ctx.payload;
    await recRequest(ctx, p.id);
    const up: any = {};
    const txt = (v: any, n: number) => String(v ?? "").trim().slice(0, n) || null;
    if ("title" in p) { up.title = String(p.title ?? "").trim().slice(0, 100); if (!up.title) throw new HttpError(400, "녹음 제목을 적어주세요"); }
    if ("due_at" in p) { const d = Date.parse(p.due_at ?? ""); if (!d) throw new HttpError(400, "마감 기한을 넣어주세요"); up.due_at = new Date(d).toISOString(); }
    if ("duration_min" in p && [10, 30, 60, 90, 120].includes(Number(p.duration_min))) up.duration_min = Number(p.duration_min);
    for (const [k, n] of [["request_dept", 60], ["requester_name", 40], ["volume_desc", 300], ["note", 1000]] as [string, number][]) {
      if (k in p) up[k] = txt(p[k], n);
    }
    if ("status" in p) { if (!REC_STATUS.includes(p.status)) throw new HttpError(400, "상태가 올바르지 않습니다"); up.status = p.status; }
    const r = must(await ctx.db.from("recording_requests").update(up).eq("id", p.id).select("*").single());
    if (p.status === "접수") return { ...r, status: await recSyncStatus(ctx, p.id) };   // 보류를 풀면 회차에 맞춰 정리
    return r;
  },

  // 가능한 시간·장소·후보: { id, role_ids? } (role_ids = 이번 회차에 녹음할 배역, 없으면 아직 회차가 없는 배역 전부)
  // 오늘부터 마감까지(최대 28일), 업무가능 시간(30분 칸)으로 녹음 시간 내내 비는 사람.
  // 엔지니어는 한 명이 끝까지 못 하면 두 명 교대도 찾아 봄. 이미 잡힌·조율 중인 녹음과 겹치는 사람·장소는 뺌.
  async "rec.plan"(ctx) {
    const { row, sec } = await recRequest(ctx, ctx.payload.id);
    const roles = await recRoles(ctx, row);
    const active: any[] = must(await ctx.db.from("recording_sessions").select("id").eq("request_id", row.id).in("status", [...REC_ACTIVE, "완료"])) ?? [];
    const activeIds = new Set(active.map((s) => s.id));
    const free = roles.filter((r: any) => !r.session_id || !activeIds.has(r.session_id));
    const want = Array.isArray(ctx.payload.role_ids) ? roles.filter((r: any) => ctx.payload.role_ids.includes(r.id)) : free;
    const k = Math.max(1, want.length);
    const now = Date.now();
    const dur = row.duration_min ?? 60, durS = recSlots(dur);
    const due = row.due_at ? Date.parse(row.due_at) : now + 14 * 86400000;
    const hours = await weeklyHours(ctx);
    const today = kstToday(), dueDay = new Date(due + 9 * HOUR).toISOString().slice(0, 10);
    const dates: string[] = [];
    for (let d = today; d <= dueDay && dates.length < 28; d = addDaysStr(d, 1)) dates.push(d);
    const people = await recPeople(ctx, sec);
    const ids = people.map((p: any) => p.id);
    const none = Promise.resolve({ data: [], error: null });
    const winFrom = kstMs(today), winTo = Math.max(due, winFrom + 86400000);
    const [av, rs, pl, du] = await Promise.all([
      ids.length && dates.length ? ctx.db.from("availability").select("person_id, avail_date, slots").in("person_id", ids).in("avail_date", dates) : none,
      ctx.db.from("recording_sessions").select("id, request_id, status, scheduled_start, scheduled_end, location, recording_requests(title), recording_participants(person_id, answer, selected, starts_at, ends_at)")
        .in("status", REC_ACTIVE).gte("scheduled_start", new Date(winFrom - 12 * HOUR).toISOString()).lt("scheduled_start", new Date(winTo).toISOString()),
      ctx.db.from("places").select("code, name, aliases, can_record").eq("is_active", true).order("sort_order"),
      ctx.db.from("duties").select("title, place, starts_at, ends_at").eq("duty_type", "녹음").is("recording_session_id", null).in("unit_id", sec.unitIds)
        .gte("starts_at", new Date(winFrom - 12 * HOUR).toISOString()).lt("starts_at", new Date(winTo).toISOString()),
    ]);
    const P = must(pl as any) ?? [], match = placeMatcher(P);
    const recPlaces = P.filter((p: any) => p.can_record);
    const avail = new Map<string, Map<string, Set<number>>>();
    for (const a of must(av as any) ?? []) {
      if (!a.slots?.length) continue;
      if (!avail.has(a.person_id)) avail.set(a.person_id, new Map());
      avail.get(a.person_id)!.set(a.avail_date, new Set(a.slots));
    }
    const busyP = new Map<string, [number, number][]>(), busyPl = new Map<string, [number, number][]>();
    const busy: any[] = [];
    const add = (m: Map<string, [number, number][]>, key: string, s: number, e: number) => { if (!m.has(key)) m.set(key, []); m.get(key)!.push([s, e]); };
    for (const s of must(rs as any) ?? []) {
      if (s.request_id === row.id && s.status === "조율중") continue;   // 같은 요청의 조율 중 회차는 다시 짤 수 있게
      const st = Date.parse(s.scheduled_start), en = s.scheduled_end ? Date.parse(s.scheduled_end) : st + 2 * HOUR;
      for (const pp of s.recording_participants ?? []) {
        if (pp.selected || (s.status === "조율중" && ["대기", "수락"].includes(pp.answer)))
          add(busyP, pp.person_id, pp.starts_at ? Date.parse(pp.starts_at) : st, pp.ends_at ? Date.parse(pp.ends_at) : en);
      }
      const code = match(s.location);
      if (code) add(busyPl, code, st, en);
      if (code && recPlaces.some((p: any) => p.code === code) && en > now) busy.push({ place: code, start: st, end: en, title: s.recording_requests?.title ?? "녹음", status: s.status });
    }
    for (const d of must(du as any) ?? []) {
      const code = match(d.place); if (!code) continue;
      const st = Date.parse(d.starts_at), en = d.ends_at ? Date.parse(d.ends_at) : st + 2 * HOUR;
      add(busyPl, code, st, en);
      if (recPlaces.some((p: any) => p.code === code) && en > now) busy.push({ place: code, start: st, end: en, title: d.title ?? "녹음", status: "예정" });
    }

    const idx = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));
    const stat = people.map(() => ({ free: 0, fit: 0 }));
    for (const [pid, byDate] of avail) {
      const i = idx.get(pid)!;
      for (const [d, set] of byDate) for (const s of set) {
        const t = kstMs(d) + s * SLOT_MS;
        if (t >= now && t + SLOT_MS <= due && !overlaps(busyP.get(pid), t, t + SLOT_MS)) stat[i].free++;
      }
    }
    // 그 칸에 비어 있는지 (사람)
    const freeAt = (pid: string, d: string, s: number) => {
      const set = avail.get(pid)?.get(d); if (!set || !set.has(s)) return false;
      const t = kstMs(d) + s * SLOT_MS; return !overlaps(busyP.get(pid), t, t + SLOT_MS);
    };
    const slots: any[] = [];
    for (const d of dates) {
      const base = kstMs(d);
      for (let s = hours.from * 2; s + durS <= hours.to * 2; s++) {
        const st = base + s * SLOT_MS, en = st + durS * SLOT_MS;
        if (st < now + SLOT_MS || en > due) continue;
        const V: number[] = [], E: number[] = [], D: number[] = [];
        const pre: Record<number, number> = {}, suf: Record<number, number> = {};
        people.forEach((p: any, i: number) => {
          let a = 0; while (a < durS && freeAt(p.id, d, s + a)) a++;
          if (a === durS) {
            stat[i].fit++;
            if (p.voice) V.push(i); if (p.engineer) E.push(i); if (p.director) D.push(i);
          } else if (p.engineer && durS > 1) {
            let b = 0; while (b < durS && freeAt(p.id, d, s + durS - 1 - b)) b++;
            if (a) pre[i] = a; if (b) suf[i] = b;
          }
        });
        // 엔지니어: 한 명이 끝까지, 안 되면 앞·뒤 두 명 교대
        let shift: any = null;
        if (!E.length) {
          for (const a of Object.keys(pre).map(Number)) {
            for (const b of Object.keys(suf).map(Number)) {
              if (a !== b && pre[a] + suf[b] >= durS) { shift = { a, b, at: st + pre[a] * SLOT_MS }; break; }
            }
            if (shift) break;
          }
        }
        const freePl = recPlaces.filter((p: any) => !overlaps(busyPl.get(p.code), st, en)).map((p: any) => p.code);
        if (!freePl.length || (!E.length && !shift)) continue;
        // 미리 정해 둔 배역(지정·후보)에 들어갈 사람은 엔지니어·감독으로 먼저 쓰지 않음
        const reserved = new Set<number>(want.flatMap((r: any) => (r.pref_people ?? []).map((id: string) => idx.get(id)).filter((x: any) => x !== undefined)));
        const engs = E.length ? [E.find((x) => !D.includes(x) && !V.includes(x)) ?? E.find((x) => !reserved.has(x) && !V.includes(x)) ?? E.find((x) => !reserved.has(x)) ?? E[0]] : [shift.a, shift.b];
        const Ds = D.filter((x) => !engs.includes(x));
        const dir = Ds.find((x) => !V.includes(x)) ?? Ds.find((x) => !reserved.has(x)) ?? Ds[0];
        if (dir === undefined) continue;
        // 배역 채우기: 지정 → 그 사람이 비어야 함, 후보 → 후보 중 비는 사람(여럿이면 모두 후보로), 미정 → 남은 사람
        const used = new Set<number>([...engs, dir]);
        const cast: any[] = []; let fail = false;
        for (const r of want) {
          const pref = (r.pref_people ?? []).map((id: string) => idx.get(id)).filter((x: any) => x !== undefined) as number[];
          if (r.pref_method === "지정" && pref.length) {
            if (!V.includes(pref[0]) || used.has(pref[0])) { fail = true; break; }
            used.add(pref[0]); cast.push({ role_id: r.id, method: "지정", people: [pref[0]] });
          } else if (r.pref_method === "후보" && pref.length) {
            const ok = pref.filter((x) => V.includes(x) && !used.has(x));
            if (!ok.length) { fail = true; break; }
            ok.forEach((x) => used.add(x)); cast.push({ role_id: r.id, method: "후보", people: ok });
          } else cast.push({ role_id: r.id, method: "지정", people: [] });
        }
        if (fail) continue;
        for (const c of cast) if (!c.people.length) {
          const x = V.find((v) => !used.has(v));
          if (x === undefined) { fail = true; break; }
          used.add(x); c.people = [x];
        }
        if (fail) continue;
        if (slots.length < 400) slots.push({
          start: st, end: en, v: V, e: E, d: D, places: freePl,
          shift: shift ? { a: shift.a, b: shift.b, at: shift.at } : null,
          pick: { cast, engineer: engs, director: dir, split: shift ? shift.at : null },
        });
      }
    }
    return {
      request: row, due, duration_min: dur, minutes: durS * 30, need: k, hours, dates,
      roles: roles.map((r: any) => ({ id: r.id, name: r.name, session_id: r.session_id, busy: !!r.session_id && activeIds.has(r.session_id), pref_method: r.pref_method, pref_people: r.pref_people ?? [] })),
      want: want.map((r: any) => r.id),
      people: people.map((p: any, i: number) => ({ ...p, free_h: stat[i].free / 2, fit: stat[i].fit, submitted: avail.has(p.id) })),
      places: recPlaces.map((p: any) => ({ code: p.code, name: p.name })),
      busy: busy.sort((a, b) => a.start - b.start), slots,
    };
  },

  // 회차 제안 보내기: { id, start(ms), place(장소 코드), cast:[{ role_id, method:"지정"|"후보", people:[id…] }],
  //                    engineers:[id] (1~2명), split?(ms, 2명이면 교대 시각), director:id }
  // → 회차(조율중) + 사람(대기) 저장, 한 사람씩 '수락/조율 응답하기' 알림
  async "rec.propose"(ctx) {
    const p = ctx.payload;
    const { row, sec } = await recRequest(ctx, p.id);
    if (["보류", "취소"].includes(row.status)) throw new HttpError(400, `${row.status}된 요청이에요`);
    const st = Number(p.start);
    if (!st || st % SLOT_MS !== 0) throw new HttpError(400, "시작 시간이 올바르지 않습니다");
    if (st < Date.now()) throw new HttpError(400, "이미 지난 시간이에요");
    const en = st + recSlots(row.duration_min) * SLOT_MS;
    const roles = await recRoles(ctx, row);
    const active: any[] = must(await ctx.db.from("recording_sessions").select("id").eq("request_id", row.id).in("status", [...REC_ACTIVE, "완료"])) ?? [];
    const activeIds = new Set(active.map((s) => s.id));
    const cast: any[] = Array.isArray(p.cast) ? p.cast : [];
    if (!cast.length) throw new HttpError(400, "녹음할 배역을 골라주세요");
    const people = await recPeople(ctx, sec);
    const pm = new Map(people.map((x: any) => [x.id, x]));
    const nm = (id: string) => (pm.get(id) as any)?.name ?? "";
    for (const c of cast) {
      const r = roles.find((x: any) => x.id === c.role_id);
      if (!r) throw new HttpError(400, "배역이 올바르지 않습니다");
      if (r.session_id && activeIds.has(r.session_id)) throw new HttpError(409, `'${r.name}' 배역은 이미 다른 회차에 들어가 있어요`);
      c.people = [...new Set((Array.isArray(c.people) ? c.people : []).map(String))];
      if (!["지정", "후보"].includes(c.method)) throw new HttpError(400, "지정·후보를 골라주세요");
      if (!c.people.length) throw new HttpError(400, `'${r.name}' 배역에 사람을 골라주세요`);
      if (c.method === "지정" && c.people.length !== 1) throw new HttpError(400, `'${r.name}' 배역은 지정이라 한 명만 골라주세요`);
      if (c.people.length > 5) throw new HttpError(400, "후보는 다섯 명까지예요");
      if (c.people.some((id: string) => !(pm.get(id) as any)?.voice)) throw new HttpError(400, "성우팀이 아닌 사람이 있어요");
    }
    const engs = [...new Set((Array.isArray(p.engineers) ? p.engineers : []).map(String))] as string[];
    if (engs.length < 1 || engs.length > 2) throw new HttpError(400, "엔지니어를 한 명 또는 두 명(교대) 골라주세요");
    if (engs.some((id) => !(pm.get(id) as any)?.engineer)) throw new HttpError(400, "엔지니어팀이 아닌 사람이 있어요");
    let split = 0;
    if (engs.length === 2) {
      split = Number(p.split);
      if (!split || split % SLOT_MS !== 0 || split <= st || split >= en) throw new HttpError(400, "교대 시각을 골라주세요");
    }
    const dir = String(p.director ?? "");
    if (!(pm.get(dir) as any)?.director) throw new HttpError(400, "감독(교관 이상)을 골라주세요");
    const P = must(await ctx.db.from("places").select("code, name, aliases, can_record").eq("is_active", true)) ?? [];
    const place = P.find((x: any) => x.code === p.place && x.can_record);
    if (!place) throw new HttpError(400, "녹음 장소를 골라주세요");
    // 장소·확정된 사람이 겹치는지
    const match = placeMatcher(P);
    const others: any[] = must(await ctx.db.from("recording_sessions").select("id, scheduled_start, scheduled_end, location, recording_participants(person_id, selected)")
      .in("status", REC_ACTIVE).lt("scheduled_start", new Date(en).toISOString()).gte("scheduled_start", new Date(st - 12 * HOUR).toISOString())) ?? [];
    const all = [...cast.flatMap((c) => c.people), ...engs, dir];
    const clash = new Set<string>();
    for (const o of others) {
      const os = Date.parse(o.scheduled_start), oe = o.scheduled_end ? Date.parse(o.scheduled_end) : os + 2 * HOUR;
      if (!(os < en && st < oe)) continue;
      if (match(o.location) === place.code) throw new HttpError(409, `${place.name}에 그 시간 다른 녹음이 있어요`);
      for (const pp of o.recording_participants ?? []) if (pp.selected && all.includes(pp.person_id)) clash.add(nm(pp.person_id));
    }
    if (clash.size) throw new HttpError(409, `${[...clash].join(", ")}님은 그 시간에 확정된 다른 녹음이 있어요`);

    await rateLimit(ctx, "rec_propose", 10, 30);
    const { count } = await ctx.db.from("recording_sessions").select("id", { count: "exact", head: true }).eq("request_id", row.id).neq("status", "취소");
    const sess = must(await ctx.db.from("recording_sessions").insert({
      team_id: row.team_id, request_id: row.id, title: `${(count ?? 0) + 1}회차`, scheduled_start: new Date(st).toISOString(), scheduled_end: new Date(en).toISOString(),
      location: place.name, status: "조율중", created_by: ctx.me.id,
    }).select("*").single());
    const rows: any[] = [];
    for (const c of cast) for (const pid of c.people) rows.push({ session_id: sess.id, person_id: pid, role: "녹음자", role_id: c.role_id, method: c.method, answer: "대기", selected: false });
    engs.forEach((pid, i) => rows.push({
      session_id: sess.id, person_id: pid, role: "엔지니어", answer: "대기", selected: false,
      starts_at: engs.length === 2 ? new Date(i === 0 ? st : split).toISOString() : null,
      ends_at: engs.length === 2 ? new Date(i === 0 ? split : en).toISOString() : null,
    }));
    rows.push({ session_id: sess.id, person_id: dir, role: "감독자", answer: "대기", selected: false });
    const parts = must(await ctx.db.from("recording_participants").insert(rows).select("*"));
    must(await ctx.db.from("recording_roles").update({ session_id: sess.id }).in("id", cast.map((c) => c.role_id)));
    await recSyncStatus(ctx, row.id);
    const roleNames = new Map(roles.map((r: any) => [r.id, r.name]));
    const notify = await recAsk(ctx, row, sess, parts, roleNames as Map<string, string>);
    return { session_id: sess.id, notify };
  },

  // 내게 온 녹음 요청 한 건 보기: { participant_id } → 본인(또는 녹음 관계자)
  async "rec.ask"(ctx) {
    const pt = must(await ctx.db.from("recording_participants").select("*").eq("id", ctx.payload.participant_id).maybeSingle());
    if (!pt) throw new HttpError(404, "녹음 요청을 찾을 수 없어요. 취소됐을 수 있어요");
    const s = await recSessionFull(ctx, pt.session_id);
    const mine = pt.person_id === ctx.me.id;
    const run = await recCanRun(ctx, s);
    if (!mine && !run) throw new HttpError(403, "녹음 요청은 세 팀 교관 이상만 볼 수 있어요");
    if (mine && !pt.seen_at) { pt.seen_at = new Date().toISOString(); must(await ctx.db.from("recording_participants").update({ seen_at: pt.seen_at }).eq("id", pt.id)); }
    const req = must(await ctx.db.from("recording_requests").select("id, title, request_code, request_dept, volume_desc, note, due_at").eq("id", s.request_id).single());
    const role = pt.role_id ? must(await ctx.db.from("recording_roles").select("name").eq("id", pt.role_id).maybeSingle()) : null;
    const names = await nameMap(ctx, [s.created_by, ...(s.recording_participants ?? []).map((x: any) => x.person_id)]);
    const mates = (s.recording_participants ?? []).filter((x: any) => x.id !== pt.id && x.answer !== "미선정").map((x: any) => ({
      id: x.id, name: names.get(x.person_id) ?? "", role: REC_ROLE_KO[x.role] ?? x.role, answer: x.answer, selected: x.selected, arrived_at: x.arrived_at,
    }));
    return {
      id: pt.id, mine: pt.person_id === ctx.me.id, role: pt.role, role_ko: REC_ROLE_KO[pt.role] ?? pt.role, role_name: role?.name ?? null, method: pt.method,
      answer: pt.answer, note: pt.answer_note ?? "", selected: pt.selected,
      from: pt.starts_at ? Date.parse(pt.starts_at) : null, to: pt.ends_at ? Date.parse(pt.ends_at) : null,
      session: { id: s.id, title: s.title ?? "", status: s.status, start: Date.parse(s.scheduled_start), end: Date.parse(s.scheduled_end), location: s.location ?? "", by: names.get(s.created_by) ?? "",
        started_at: s.started_at, ended_at: s.ended_at },
      arrived_at: pt.arrived_at, can_arrive: recArriveOpen(s), can_run: run,
      request: { title: req.title, code: req.request_code, dept: req.request_dept, volume: req.volume_desc, note: req.note },
      mates,
    };
  },

  // 수락·조율: { participant_id, answer: "수락"|"조율", note? } → 본인만. 요청자에게 알림, 다 모이면 확정
  async "rec.answer"(ctx) {
    const { participant_id, answer } = ctx.payload;
    if (!["수락", "조율"].includes(answer)) throw new HttpError(400, "수락 또는 조율을 골라주세요");
    const pt = must(await ctx.db.from("recording_participants").select("*").eq("id", participant_id).maybeSingle());
    if (!pt) throw new HttpError(404, "녹음 요청을 찾을 수 없어요. 취소됐을 수 있어요");
    if (pt.person_id !== ctx.me.id) throw new HttpError(403, "본인만 응답할 수 있어요");
    if (pt.answer === "미선정") throw new HttpError(400, "이번 녹음은 다른 분이 맡게 됐어요");
    const s = await recSessionFull(ctx, pt.session_id);
    if (!REC_ACTIVE.includes(s.status)) throw new HttpError(400, s.status === "취소" ? "취소된 녹음이에요" : "이미 끝난 녹음이에요");
    if (Date.parse(s.scheduled_start) < Date.now()) throw new HttpError(400, "이미 시작 시간이 지났어요");
    const note = String(ctx.payload.note ?? "").trim().slice(0, 300) || null;
    if (answer === "조율" && !note) throw new HttpError(400, "조율이 필요한 내용(가능한 시간 등)을 적어주세요");
    if (pt.answer === answer && (pt.answer_note ?? null) === note) return { ok: true, answer, selected: pt.selected, done: s.status === "예정" };   // 그대로면 알림 안 보냄
    if (pt.answered_at && Date.now() - Date.parse(pt.answered_at) < 30000) throw new HttpError(429, "잠시 뒤에 다시 바꿔주세요");
    // 지정·엔지니어·감독은 수락하면 바로 확정. 후보는 요청자가 고르면 확정
    const selected = answer === "수락" ? (pt.role !== "녹음자" || pt.method === "지정" || pt.selected) : false;
    must(await ctx.db.from("recording_participants").update({ answer, answer_note: note, answered_at: new Date().toISOString(), selected }).eq("id", pt.id));
    if (answer === "조율" && s.status === "예정") {   // 확정된 뒤에 조율이 생기면 다시 조율 중으로
      must(await ctx.db.from("recording_sessions").update({ status: "조율중", confirmed_at: null }).eq("id", s.id));
      await recSyncStatus(ctx, s.request_id);
    }
    const req = must(await ctx.db.from("recording_requests").select("id, title").eq("id", s.request_id).single());
    const role = pt.role_id ? must(await ctx.db.from("recording_roles").select("name").eq("id", pt.role_id).maybeSingle()) : null;
    if (s.created_by && s.created_by !== ctx.me.id) {
      const head = answer === "수락" ? `👍 <b>${escHtml(ctx.me.name)}</b>님이 수락했어요` : `⚠️ <b>${escHtml(ctx.me.name)}</b>님이 조율이 필요하대요`;
      await sendToMembers(await withTelegram(ctx, [s.created_by]),
        [head, `${escHtml(req.title ?? "녹음")} · ${escHtml(partLabel(pt, role?.name))}`, `${msLabel(Date.parse(s.scheduled_start))} · ${escHtml(s.location ?? "")}`,
          note ? `💬 ${escHtml(note)}` : "", answer === "수락" && pt.role === "녹음자" && pt.method === "후보" ? "후보라서 요청 화면에서 '이 사람으로'를 눌러 정해 주세요" : ""].filter(Boolean).join("\n"),
        recButton(req.id));
    }
    const fin = await recFinalize(ctx, s.id);
    return { ok: true, answer, selected, done: fin.done };
  },

  // 후보 중 한 명으로 정하기: { participant_id } → 수락한 후보만. 같은 배역 다른 후보는 선택 해제
  async "rec.select"(ctx) {
    const pt = must(await ctx.db.from("recording_participants").select("*").eq("id", ctx.payload.participant_id).maybeSingle());
    if (!pt || pt.role !== "녹음자") throw new HttpError(404, "후보를 찾을 수 없습니다");
    const s = await recSessionFull(ctx, pt.session_id);
    await recSection(ctx, s.team_id);
    if (s.status !== "조율중") throw new HttpError(400, "조율 중인 회차에서만 바꿀 수 있어요");
    if (pt.answer !== "수락") throw new HttpError(400, "수락한 사람만 정할 수 있어요");
    must(await ctx.db.from("recording_participants").update({ selected: false }).eq("session_id", s.id).eq("role", "녹음자").eq("role_id", pt.role_id));
    must(await ctx.db.from("recording_participants").update({ selected: true }).eq("id", pt.id));
    return { ok: true, done: (await recFinalize(ctx, s.id)).done };
  },

  // 사람 더하기(후보 추가·사람 바꾸기): { session_id, kind: voice|engineer|director, person_id, role_id?, method? } → 알림
  async "rec.addPerson"(ctx) {
    const p = ctx.payload;
    const s = await recSessionFull(ctx, p.session_id);
    const sec = await recSection(ctx, s.team_id);
    if (s.status !== "조율중") throw new HttpError(400, "조율 중인 회차에서만 사람을 더할 수 있어요");
    const role = REC_ROLE[p.kind];
    if (!role) throw new HttpError(400, "역할이 올바르지 않습니다");
    const who = (await recPeople(ctx, sec)).find((x: any) => x.id === p.person_id);
    if (!who || !(who as any)[p.kind]) throw new HttpError(400, "이 역할에 맞지 않는 사람이에요");
    let roleName: string | undefined;
    if (role === "녹음자") {
      const r = must(await ctx.db.from("recording_roles").select("id, name, session_id").eq("id", p.role_id).maybeSingle());
      if (!r || r.session_id !== s.id) throw new HttpError(400, "배역이 올바르지 않습니다");
      roleName = r.name;
    }
    await rateLimit(ctx, "rec_add", 20, 30);
    const ins = await ctx.db.from("recording_participants").insert({
      session_id: s.id, person_id: who.id, role, role_id: role === "녹음자" ? p.role_id : null,
      method: role === "녹음자" ? (p.method === "지정" ? "지정" : "후보") : null, answer: "대기", selected: false,
    }).select("*").single();
    if (ins.error?.code === "23505") throw new HttpError(409, "이미 들어가 있는 사람이에요");
    const pt = must(ins);
    const req = must(await ctx.db.from("recording_requests").select("*").eq("id", s.request_id).single());
    const notify = await recAsk(ctx, req, s, [pt], new Map(roleName ? [[p.role_id, roleName]] : []));
    return { ok: true, notify };
  },

  // 사람 빼기: { participant_id } → 조율 중인 회차에서. 대기·수락이던 사람에게는 '요청 취소' 알림
  async "rec.removePerson"(ctx) {
    const pt = must(await ctx.db.from("recording_participants").select("*").eq("id", ctx.payload.participant_id).maybeSingle());
    if (!pt) throw new HttpError(404, "사람을 찾을 수 없습니다");
    const s = await recSessionFull(ctx, pt.session_id);
    await recSection(ctx, s.team_id);
    if (s.status !== "조율중") throw new HttpError(400, "조율 중인 회차에서만 뺄 수 있어요");
    await rateLimit(ctx, "rec_remove", 20, 30);
    must(await ctx.db.from("recording_participants").delete().eq("id", pt.id));
    if (["대기", "수락"].includes(pt.answer) && pt.person_id !== ctx.me.id) {
      const req = must(await ctx.db.from("recording_requests").select("title").eq("id", s.request_id).single());
      await sendToMembers(await withTelegram(ctx, [pt.person_id]),
        `🎙 <b>${escHtml(req.title ?? "녹음")}</b>\n${msLabel(Date.parse(s.scheduled_start))} 녹음 요청이 취소됐어요. 응답하지 않으셔도 돼요`);
    }
    return { ok: true, done: (await recFinalize(ctx, s.id)).done };
  },

  // 아직 답이 없는 사람에게 다시 알림: { session_id } → 10분에 한 번
  async "rec.remind"(ctx) {
    const s = await recSessionFull(ctx, ctx.payload.session_id);
    await recSection(ctx, s.team_id);
    if (s.status !== "조율중") throw new HttpError(400, "조율 중인 회차가 아니에요");
    const wait = (s.recording_participants ?? []).filter((p: any) => p.answer === "대기");
    if (!wait.length) throw new HttpError(400, "아직 답하지 않은 사람이 없어요");
    const last = Math.max(0, ...wait.map((p: any) => (p.notified_at ? Date.parse(p.notified_at) : 0)));
    if (Date.now() - last < 10 * 60000) throw new HttpError(429, "알림은 10분에 한 번만 보낼 수 있어요");
    const req = must(await ctx.db.from("recording_requests").select("*").eq("id", s.request_id).single());
    const roles: any[] = must(await ctx.db.from("recording_roles").select("id, name").eq("request_id", req.id)) ?? [];
    return { notify: await recAsk(ctx, req, s, wait, new Map(roles.map((r) => [r.id, r.name])), "🔔 <b>녹음 요청에 아직 답이 없어요</b>") };
  },

  // 회차 끝내기·취소: { session_id, status: "완료" | "취소" }
  // 내가 맡은 녹음 (누구나): 미선정·취소 빼고, 지난 14일 ~ 앞으로. 누르면 응답 팝업(rec.ask)
  async "rec.mine"(ctx) {
    const rows: any[] = must(await ctx.db.from("recording_participants")
      .select("id, role, answer, selected, arrived_at, recording_sessions!inner(id, title, status, scheduled_start, scheduled_end, location, started_at, ended_at, recording_requests(title))")
      .eq("person_id", ctx.me.id).neq("answer", "미선정").neq("recording_sessions.status", "취소")
      .gte("recording_sessions.scheduled_start", new Date(Date.now() - 14 * 24 * HOUR).toISOString())) ?? [];
    return rows.map((r) => ({ id: r.id, role: REC_ROLE_KO[r.role] ?? r.role, answer: r.answer, selected: r.selected, arrived_at: r.arrived_at,
      title: r.recording_sessions.recording_requests?.title ?? "녹음", session: r.recording_sessions.title ?? "", status: r.recording_sessions.status,
      start: Date.parse(r.recording_sessions.scheduled_start), end: r.recording_sessions.scheduled_end ? Date.parse(r.recording_sessions.scheduled_end) : null,
      location: r.recording_sessions.location ?? "", ended: !!r.recording_sessions.ended_at }))
      .sort((a, b) => a.start - b.start);
  },
  // 녹음실 도착 { participant_id }: 본인, 또는 그 회차 엔지니어·교관 이상이 대신 확인
  async "rec.arrive"(ctx) {
    const pt = must(await ctx.db.from("recording_participants").select("*").eq("id", ctx.payload?.participant_id).maybeSingle());
    if (!pt || !pt.selected) throw new HttpError(404, "확정된 녹음이 아니에요");
    const s = await recSessionFull(ctx, pt.session_id);
    if (pt.person_id !== ctx.me.id && !(await recCanRun(ctx, s))) throw new HttpError(403, "본인이나 그 녹음 엔지니어만 누를 수 있어요");
    if (!recArriveOpen(s)) throw new HttpError(400, "녹음 시작 2시간 전부터 누를 수 있어요");
    await recMarkArrived(ctx, s, pt);
    return { ok: true };
  },
  // 시작 보고 { session_id }: 그 회차 엔지니어 또는 교관 이상. 회차 만든 사람에게 알림
  async "rec.start"(ctx) {
    const s = await recSessionFull(ctx, ctx.payload?.session_id);
    if (!(await recCanRun(ctx, s))) throw new HttpError(403, "그 녹음 엔지니어만 보고할 수 있어요");
    if (s.status !== "예정") throw new HttpError(400, "확정된 녹음만 시작할 수 있어요");
    if (s.started_at) return { ok: true };
    must(await ctx.db.from("recording_sessions").update({ started_at: new Date().toISOString(), started_by: ctx.me.id }).eq("id", s.id));
    const req = must(await ctx.db.from("recording_requests").select("title").eq("id", s.request_id).single());
    if (s.created_by !== ctx.me.id) await sendToMembers(await withTelegram(ctx, [s.created_by]), `🔴 <b>녹음 시작</b> · ${escHtml(req.title ?? "녹음")}${s.title ? " · " + escHtml(s.title) : ""}\n${escHtml(ctx.me.name)}님 보고`);
    return { ok: true };
  },
  // 종료 보고 '녹음 마쳤습니다' { session_id } → 회차 완료(배지 판정·요청 상태도). 회차 만든 사람에게 알림
  async "rec.end"(ctx) {
    const s = await recSessionFull(ctx, ctx.payload?.session_id);
    if (!(await recCanRun(ctx, s))) throw new HttpError(403, "그 녹음 엔지니어만 보고할 수 있어요");
    if (s.status !== "예정") throw new HttpError(400, "확정된 녹음만 마칠 수 있어요");
    const now = new Date().toISOString();
    must(await ctx.db.from("recording_sessions").update({ status: "완료", ended_at: now, ended_by: ctx.me.id, started_at: s.started_at ?? now, started_by: s.started_at ? undefined : ctx.me.id }).eq("id", s.id));
    await awardBadges(ctx, (s.recording_participants ?? []).filter((x: any) => x.role === "녹음자" && x.selected).map((x: any) => x.person_id));
    const req = must(await ctx.db.from("recording_requests").select("title").eq("id", s.request_id).single());
    if (s.created_by !== ctx.me.id) await sendToMembers(await withTelegram(ctx, [s.created_by]), `✅ <b>녹음 마쳤습니다</b> · ${escHtml(req.title ?? "녹음")}${s.title ? " · " + escHtml(s.title) : ""}\n${escHtml(ctx.me.name)}님 보고`);
    return { ok: true, status: await recSyncStatus(ctx, s.request_id) };
  },
  async "rec.sessionStatus"(ctx) {
    const { session_id, status } = ctx.payload;
    if (!["완료", "취소"].includes(status)) throw new HttpError(400, "상태가 올바르지 않습니다");
    const s = await recSessionFull(ctx, session_id);
    await recSection(ctx, s.team_id);
    if (status === "완료" && s.status !== "예정") throw new HttpError(400, "확정된 회차만 완료할 수 있어요");
    if (status === "취소") await rateLimit(ctx, "rec_cancel", 10, 30);
    must(await ctx.db.from("recording_sessions").update({ status }).eq("id", s.id));
    if (status === "완료") await awardBadges(ctx, (s.recording_participants ?? []).filter((x: any) => x.role === "녹음자" && x.selected).map((x: any) => x.person_id));
    let notify = null;
    if (status === "취소") {
      must(await ctx.db.from("recording_roles").update({ session_id: null }).eq("session_id", s.id));
      if (Date.parse(s.scheduled_start) > Date.now()) {
        const req = must(await ctx.db.from("recording_requests").select("title").eq("id", s.request_id).single());
        const ids = (s.recording_participants ?? []).filter((x: any) => x.answer !== "미선정" && x.person_id !== ctx.me.id).map((x: any) => x.person_id);
        notify = await sendToMembers(await withTelegram(ctx, [...new Set(ids)] as string[]),
          `🎙 <b>녹음이 취소됐어요</b>\n<b>${escHtml(req.title ?? "녹음")}</b>${s.title ? " · " + escHtml(s.title) : ""}\n${msLabel(Date.parse(s.scheduled_start))} · ${escHtml(s.location ?? "")}`);
      }
    }
    return { ok: true, status: await recSyncStatus(ctx, s.request_id), notify };
  },

  // ----- 홈 월 달력 -----
  // { team_id, month: "YYYY-MM" } → 그달(앞뒤 주 포함 6주)의 과 전체 모임·녹음·업무·사명자 일정
  async "dashboard.month"(ctx) {
    const { team_id } = ctx.payload;
    await requireRank(ctx, team_id, RANK.MEMBER);
    const month = String(ctx.payload.month ?? kstToday().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month 형식이 틀렸습니다");
    const first = month + "-01";
    const dow = new Date(first + "T00:00:00Z").getUTCDay();
    const gridStart = addDaysStr(first, -dow), gridEnd = addDaysStr(gridStart, 42);
    const sec = await sectionOf(ctx, team_id);
    const canDetail = await canSeeDetail(ctx, sec.teamIds);
    const items = await sectionItems(ctx, sec, kstMs(gridStart), kstMs(gridEnd), canDetail);
    return { month, from: gridStart, to: gridEnd, items };
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
      .select("person_id, org_unit_id, people(name, is_active, town_look), positions(name, rank)")
      .in("org_unit_id", unitIds).lte("started_on", today).or(`ended_on.is.null,ended_on.gte.${today}`)) ?? [];
    const ppl = new Map<string, any>();
    for (const r of pos) {
      if (!r.people?.is_active) continue;
      const rank = r.positions?.rank ?? 0, cur = ppl.get(r.person_id);
      if (!cur || rank > cur.rank) {
        ppl.set(r.person_id, { id: r.person_id, name: r.people.name, rank, role: r.positions?.name ?? "", look: r.people.town_look ?? null,
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
        .select("id, team_id, scheduled_start, scheduled_end, location, status, recording_requests(title, request_code), recording_participants(person_id, role, selected, starts_at, ends_at)")
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
      if (!["예정", "완료", "재녹음필요"].includes(r.status)) continue;   // 조율 중·취소는 안 보임
      const st = Date.parse(r.scheduled_start), en = r.scheduled_end ? Date.parse(r.scheduled_end) : st + 2 * HOUR;
      const req = r.recording_requests, base = req ? [req.title, req.request_code].filter(Boolean).join(" · ") : "녹음";
      for (const pt of r.recording_participants ?? []) {
        if (!pt.selected) continue;   // 확정된 사람만 (엔지니어 교대면 자기 시간만)
        const ps = pt.starts_at ? Date.parse(pt.starts_at) : st, pe = pt.ends_at ? Date.parse(pt.ends_at) : en;
        push(pt.person_id, toMin(ps), toMin(pe), where(r.location), "녹음", "",
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

    // 대표 칭호: 본인이 고른 것만 (안 고르면 없음)
    const titles: any[] = ids.length ? must(await ctx.db.from("person_badges").select("person_id, badges(name, icon)").in("person_id", ids).eq("is_title", true)) ?? [] : [];
    const titleOf = new Map(titles.filter((t) => t.badges).map((t) => [t.person_id, `${t.badges.icon} ${t.badges.name}`]));
    const people = [...ppl.values()].sort((a, b) => a.team.localeCompare(b.team) || b.rank - a.rank || a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name, team: p.team, role: [p.role, p.group].filter(Boolean).join(" · "), ...(p.look ? { look: p.look } : {}), ...(titleOf.has(p.id) ? { title: titleOf.get(p.id) } : {}) }));
    // 새로 불러오는 간격 (설정값 town_refresh_sec, 기본 60초)
    const rs = must(await ctx.db.from("app_settings").select("value").eq("key", "town_refresh_sec").maybeSingle());
    const refresh_sec = Math.max(15, Number(rs?.value ?? 60) || 60);
    return { date: today, can_detail: canDetail, people, segs, refresh_sec };
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
    // 비밀값이 빠져 있으면 서명 검사가 무력해지므로 아예 멈춤
    if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) { console.error("missing secrets"); return json({ ok: false, error: "서버 설정 오류" }, 500); }
    if (Number(req.headers.get("content-length") ?? 0) > 200_000) return json({ ok: false, error: "보내는 내용이 너무 커요" }, 413);
    const raw = await req.text();
    if (raw.length > 200_000) return json({ ok: false, error: "보내는 내용이 너무 커요" }, 413);
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }

    // 텔레그램 봇 채팅(웹훅): 텔레그램이 붙여 보내는 비밀값 헤더로 확인. 처리 중 오류가 나도 200으로 답함(텔레그램이 계속 다시 보내지 않게)
    const hookSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (hookSecret !== null) {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const want = must(await admin.rpc("tg_webhook_secret"));
      if (!want || !safeEqual(hookSecret, String(want))) return json({ ok: false }, 401);
      try { await handleTelegramUpdate(admin, body); } catch (e) { console.error("bot", e); }
      return json({ ok: true });
    }

    // 로그인 전에도 쓰는 공개 기능: 로그인 버튼용 봇 아이디
    if (body.action === "public.bot") return json({ ok: true, data: { username: await getBotUsername() } });

    // pg_cron(10분마다)이 부르는 자동 알림. 텔레그램 로그인 대신 vault의 비밀값으로 확인
    // cron.setWebhook: 봇 채팅 답장을 이 함수로 돌림 / cron.webhookInfo: 지금 어디로 가는지
    const CRON = ["cron.reminders", "cron.betaMenu", "cron.setWebhook", "cron.webhookInfo"];
    if (CRON.includes(body.action)) {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const secret = req.headers.get("x-cron-secret") ?? "";
      if (!secret || !must(await admin.rpc("check_cron_secret", { p_secret: secret }))) throw new HttpError(401, "인증 실패");
      if (body.action === "cron.setWebhook") return json({ ok: true, data: await setWebhookHere(admin) });
      if (body.action === "cron.webhookInfo") {
        const r = await tgCall("getWebhookInfo", {});
        const url = String(r?.result?.url ?? "");
        return json({ ok: true, data: { target: url.includes("supabase.co") ? "supabase" : url.includes("script.google") ? "apps-script" : url ? "other" : "none",
          pending: r?.result?.pending_update_count ?? null, last_error: r?.result?.last_error_message ?? null } });
      }
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

    // 기능 이름은 actions에 직접 적힌 것만 (constructor·toString 같은 기본 속성으로 엉뚱한 게 불리지 않게)
    const name = typeof body.action === "string" ? body.action : "";
    const handler = Object.hasOwn(actions, name) ? actions[name] : null;
    if (typeof handler !== "function") throw new HttpError(400, "알 수 없는 기능입니다");

    const data = await handler({ db, me, payload: body.payload ?? {} });
    return json({ ok: true, data });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ ok: false, error: status === 500 ? "서버 오류가 발생했습니다" : e.message, ...(e instanceof HttpError ? e.extra ?? {} : {}) }, status);
  }
});
