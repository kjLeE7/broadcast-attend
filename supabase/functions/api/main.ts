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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
// 기능(action) 목록
// ---------------------------------------------------------------------
const ATTENDANCE_FIELDS = [
  "status", "reason", "departed_at", "arrived_at",
  "makeup_required", "makeup_type", "makeup_done", "makeup_note",
];

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

  // 모임 회차 만들기: { team_id, meeting_type_id, title?, session_date, start_time?, end_time?, location?, place_mode? } → 교관 이상
  async "sessions.create"(ctx) {
    const p = ctx.payload;
    await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    if (!p.session_date) throw new HttpError(400, "날짜를 입력해주세요");
    if (p.meeting_type_id) {
      const t = must(await ctx.db.from("meeting_types").select("team_id").eq("id", p.meeting_type_id).maybeSingle());
      if (!t || t.team_id !== p.team_id) throw new HttpError(400, "이 팀의 모임 유형이 아닙니다");
    }
    return must(await ctx.db.from("meeting_sessions").insert({
      ...pick(p, ["meeting_type_id", "title", "session_date", "start_time", "end_time", "location", "place_mode", "target_unit_id"]),
      team_id: p.team_id,
      created_by: ctx.me.id,
    }).select("*, meeting_types(name)").single());
  },

  // 모임 회차 수정·취소: { id, ...고칠 칸 } → 교관 이상
  async "sessions.update"(ctx) {
    const { id } = ctx.payload;
    await requireRank(ctx, await sessionTeam(ctx, id), RANK.INSTRUCTOR);
    return must(await ctx.db.from("meeting_sessions")
      .update(pick(ctx.payload, ["title", "session_date", "start_time", "end_time", "location", "place_mode", "status"]))
      .eq("id", id).select("*, meeting_types(name)").single());
  },

  // 모임 회차 목록: { team_id, from?, to? }
  async "sessions.list"(ctx) {
    const { team_id, from, to } = ctx.payload;
    await requireRank(ctx, team_id, RANK.MEMBER);
    let q = ctx.db.from("meeting_sessions")
      .select("*, meeting_types(name)")
      .eq("team_id", team_id)
      .order("session_date", { ascending: true });
    if (from) q = q.gte("session_date", from);
    if (to) q = q.lte("session_date", to);
    return must(await q);
  },

  // 출결 목록: { session_id } → 조장 이상은 전체, 팀원은 본인 것만
  async "attendance.list"(ctx) {
    const { session_id } = ctx.payload;
    const teamId = await sessionTeam(ctx, session_id);
    const rank = await rankIn(ctx, teamId);
    if (rank < RANK.MEMBER) throw new HttpError(403, "권한이 없습니다");

    let q = ctx.db.from("attendance")
      .select("*, people(name)")
      .eq("session_id", session_id);
    if (rank < RANK.GROUP_LEADER) q = q.eq("person_id", ctx.me.id);
    return must(await q);
  },

  // 내 출결 입력·수정: { session_id, status, reason, departed_at, arrived_at, ... }
  async "attendance.saveMine"(ctx) {
    const { session_id } = ctx.payload;
    const teamId = await sessionTeam(ctx, session_id);
    await requireRank(ctx, teamId, RANK.MEMBER);

    const row = { ...pick(ctx.payload, ATTENDANCE_FIELDS), session_id, person_id: ctx.me.id };
    return must(await ctx.db.from("attendance")
      .upsert(row, { onConflict: "session_id,person_id" })
      .select().single());
  },

  // 다른 사람 출결 입력(미제출자 처리 등): { session_id, person_id, status, ... } → 조장 이상
  async "attendance.saveFor"(ctx) {
    const { session_id, person_id } = ctx.payload;
    if (!person_id) throw new HttpError(400, "대상자가 없습니다");
    await requireRank(ctx, await sessionTeam(ctx, session_id), RANK.GROUP_LEADER);
    const row = { ...pick(ctx.payload, ATTENDANCE_FIELDS), session_id, person_id };
    return must(await ctx.db.from("attendance")
      .upsert(row, { onConflict: "session_id,person_id" })
      .select("*, people(name)").single());
  },

  // 출결 수정(다른 사람 것 포함): { id, ...고칠 칸 } → 본인 것이거나 조장 이상
  async "attendance.update"(ctx) {
    const { id } = ctx.payload;
    const row = must(await ctx.db.from("attendance")
      .select("person_id, session_id").eq("id", id).maybeSingle());
    if (!row) throw new HttpError(404, "출결 기록을 찾을 수 없습니다");

    if (row.person_id !== ctx.me.id) {
      await requireRank(ctx, await sessionTeam(ctx, row.session_id), RANK.GROUP_LEADER);
    }
    return must(await ctx.db.from("attendance")
      .update(pick(ctx.payload, ATTENDANCE_FIELDS))
      .eq("id", id).select().single());
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
    const [rows, groups] = await Promise.all([
      ctx.db.from("notices").select("id, team_id, title, body, target_unit_id, is_pinned, published_at, created_by")
        .in("team_id", units).order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(60),
      myGroupIds(ctx),
    ]);
    const list = (must(rows as any) ?? []).filter((r: any) => visibleToMe(r, rank, groups));
    const names = await nameMap(ctx, list.map((r: any) => r.created_by));
    return list.map((r: any) => ({
      ...r, scope: r.team_id === team_id ? "team" : "section",
      author: names.get(r.created_by) ?? null, mine: r.created_by === ctx.me.id,
    }));
  },

  // 공지 쓰기: { team_id, scope: "team"(교관 이상) | "section"(팀장 이상, 방송예술과 전체), title, body, is_pinned, target_unit_id? }
  async "notices.create"(ctx) {
    const p = ctx.payload;
    let unit = p.team_id;
    const section = p.scope === "section";
    if (section) {
      await requireRank(ctx, p.team_id, RANK.TEAM_LEADER);
      const u = must(await ctx.db.from("org_units").select("parent_id").eq("id", p.team_id).maybeSingle());
      if (!u?.parent_id) throw new HttpError(400, "상위 과를 찾을 수 없습니다");
      unit = u.parent_id;
    } else {
      await requireRank(ctx, p.team_id, RANK.INSTRUCTOR);
    }
    const title = String(p.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(400, "제목을 입력해주세요");
    return must(await ctx.db.from("notices").insert({
      team_id: unit, title, body: String(p.body ?? "").trim().slice(0, 3000) || null,
      is_pinned: !!p.is_pinned, target_unit_id: section ? null : (p.target_unit_id || null),
      created_by: ctx.me.id,
    }).select().single());
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

    // 텔레그램 미니앱(initData) 또는 PC 브라우저 로그인 버튼(x-telegram-login) 중 하나로 확인
    const initData = req.headers.get("x-telegram-init-data") ?? "";
    const login = req.headers.get("x-telegram-login") ?? "";
    if (!initData && !login) throw new HttpError(401, "텔레그램 인증 정보가 없습니다");
    const tgUser = initData ? await verifyInitData(initData) : await verifyLoginWidget(login);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const me = must(await admin.from("people")
      .select("id, name, is_active")
      .eq("telegram_user_id", tgUser.id)
      .maybeSingle());
    if (!me) throw new HttpError(403, "등록되지 않은 사용자입니다. 관리자에게 문의하세요");
    if (!me.is_active) throw new HttpError(403, "비활성화된 계정입니다. 관리자에게 문의하세요");

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
    return json({ ok: false, error: status === 500 ? "서버 오류가 발생했습니다" : e.message }, status);
  }
});
