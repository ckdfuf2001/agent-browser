# agent-browser Session Proxy

`agent-browser` MCP를 여러 에이전트/작업이 **동시에** 써도 겹치지 않게 만드는
세션 격리 프록시. 의존성 없음 (Node 내장 모듈만).

- upstream: https://github.com/vercel-labs/agent-browser
- 본 저장소 브랜치: `proxy/session-isolation` / 태그: `proxy-v2.2.0`

## 왜 필요한가 (upstream 그대로 쓰면 생기는 문제)

| # | 문제 | 원인 |
|---|------|------|
| 1 | 여러 에이전트가 같은 탭/ref를 밟아 충돌 | `AGENT_BROWSER_SESSION` 고정 or 생략 시 전원 `default` 세션 공유 |
| 2 | 안 쓰는 브라우저가 계속 쌓여 리소스 고갈 | `IDLE_TIMEOUT` 24h + 정리 주체 없음 |
| 3 | `open`이 콜드 실행에서 응답 없이 멈춤 | upstream `mcp` 서버/`open`이 첫 브라우저 기동 후 반환 안 함 (브라우저는 뒤에서 뜸, Windows 재현) |
| 4 | 제너럴 LLM이 헤맴 | 도구 62개, `session` 선택사항, stale ref/tab_gone 발생 시 복구 힌트 없음 |

## 개선점

1. **세션 강제**: `session` 필수 (스키마+실행時 검증). `default` 거부, 문자 규칙 위반 거부. 과제당 1세션.
2. **네임스페이스도 매 호출 명시**: `namespace` 필수. 값은 서버 핀 1개라 데몬도 정확히 1개 (네임스페이스마다 데몬이 뜨는 구조라 핀으로 고정).
3. **데몬 1개 + 세션별 브라우저**: 같은 데몬 아래 작업마다 별도 Chrome. 동시 호출이 서로 간섭 불가.
4. **재사용 확인**: `ensure`가 데몬에 live 존재를 먼저 확인. 이미 있는 쌍이면 탭 목록을 보여주고 `reuse:true` 확정 없이는 진입 불가. 미등록 쌍으로 도구를 직접 호출해도 `ensure`로 유도.
5. **TTL + LRU + in-flight 보호**: idle 10분이면 `close`. 진행 중 호출이 있는 세션은 정리/퇴출에서 절대 제외.
6. **재시작 내성**: 추적 레지스트리를 파일에 저장. opencode가 MCP를 재기동해도 추적·정리 이어감.
7. **open 검증 폴백**: 첫 기동 멈춤을 25초로 끊고 `get_url`로 확인 후 성공 보고. LLM이 에러 루프에 안 빠짐.
8. **한글 세션/네임스페이스**: `결제-확인` 같은 이름 허용. CLI·데몬에는 결정적 ASCII(`u`+hex)로 전달, 화면엔 원본 표시.
9. **호출 성공률**: 도구 36개로 축소, `e12`→`@e12` 자동 교정, stale ref/tab_gone/covered/타임아웃 복구 힌트, close-all 차단, `skills_get`이 프록시 전용 가이드(`skills/session-proxy/SKILL.md`)를 로컬 서빙 (CLI 스킬 번들 불필요).

## 구조

```
opencode (MCP client, stdio)
   │  tools/list · tools/call  (35 tools, JSON-RPC)
   ▼
mcp-server.mjs  ── 레지스트리(ns+session → lastSeen/inFlight, 파일 저장)
   │  호출마다: 검증 → CLI 단발 실행 → 결과 반환 (무상태)
   ▼
agent-browser CLI --namespace opencode --session <S> <cmd> --json
   ▼
agent-browser daemon ×1 ── 브라우저 ×N (세션당 1개)
```

## 설치·설정

바이너리는 릴리즈에서 바로 받으세요 (빌드 불필요):
https://github.com/ckdfuf2001/agent-browser/releases/tag/proxy-v2.2.0

| 에셋 | 내용 |
|------|------|
| `agent-browser-proxy-v2.2.0.zip` | 프록시+설정+테스트+문서 (압축 풀고 node로 바로 실행) |
| `agent-browser-win32-x64-0.33.2.zip` | 검증된 agent-browser 바이너리 (Windows x64, 설치 불필요) |

다른 머신 빠른 시작:

```sh
# 1. 위 2개 압축 해제, Node 18+ 준비
# 2. Chrome 받기 (최초 1회, ~400MB)
agent-browser.exe install
# 3. opencode.json 경로 지정
```

`opencode.json`의 MCP를 프록시로 지정 (`--cli`와 크롬 경로만 그 머신에 맞게):

```json
{
  "mcp": {
    "agent-browser": {
      "type": "local",
      "enabled": true,
      "command": ["node", "<압축해제경로>/mcp-server.mjs",
        "--cli", "<agent-browser.exe 절대경로>", "--namespace", "opencode"],
      "env": {
        "AGENT_BROWSER_EXECUTABLE_PATH": "<chromium chrome.exe 절대경로>",
        "AGENT_BROWSER_NAMESPACE": "opencode",
        "AGENT_BROWSER_IDLE_TIMEOUT_MS": "900000",
        "SESSION_TTL_MS": "600000",
        "SESSION_MAX": "16",
        "SESSION_SWEEP_MS": "60000"
      }
    }
  }
}
```

환경변수:

| 변수 | 기본값 | 의미 |
|------|--------|------|
| `AGENT_BROWSER_NAMESPACE` | `opencode` | 핀 네임스페이스 (데몬 1개) |
| `AGENT_BROWSER_IDLE_TIMEOUT_MS` | `900000` | 데몬 idle 종료 (15분) |
| `SESSION_TTL_MS` | `600000` | 세션 idle 정리 (10분) |
| `SESSION_MAX` | `16` | 추적 상한 (idle만 LRU) |
| `SESSION_SWEEP_MS` | `60000` | 스위퍼 주기 |
| `CALL_TIMEOUT_MS` | `60000` | 호출 타임아웃 |
| `SESSION_STORE` | OS tmp | 레지스트리 저장 경로 |

## 사용법 (LLM 기준)

```
1. agent_browser_session_ensure { namespace: "opencode", task: "checkout" }
   → "session ready: \"checkout-a1b2c3\""  (이미 있으면 EXISTS+탭목록 → reuse:true 로 확정)
2. 이후 모든 호출에 { namespace: "opencode", session: "checkout-a1b2c3" } 동반
3. open → snapshot → click/fill (새 @ref) → snapshot …
4. 끝나면 agent_browser_close (또는 방치하면 TTL 정리)
```

긴 가이드는 `agent_browser_skills_get` (로컬 `skills/session-proxy/SKILL.md` 서빙).

## 테스트

```sh
node test-smoke.mjs   # 가드 11종, 브라우저 불필요
```

## 알려진 이슈

- 세션당 첫 `open`은 브라우저 첫 기동이라 최대 ~35초 소요 (이후 1~2초).
  upstream `open` 콜드 hang 문제로, 프록시가 검증 후 성공 보고로 흡수함.
- `session list`에 닫힌 세션명이 남을 수 있음 (upstream 세션 기록 유지 동작).
  브라우저 프로세스는 정리됨.

## 파일 구성

| 파일 | 설명 |
|------|------|
| `mcp-server.mjs` | 프록시 본체 (의존성 없음) |
| `skills/session-proxy/SKILL.md` | LLM용 사용 가이드 (`skills_get`이 로컬 서빙, upstream CLI 스킬과 달리 프록시 규칙 반영) |
| `opencode.json` | MCP 연결 설정 예시 |
| `package.json` | `npm test` (= test-smoke) |
| `test-smoke.mjs` | 계약 테스트 |
| `chat_uploads/agent-browser_arch-to-be.html` | 아키텍처 문서 |

## 버전

- `proxy-v2.2.0`: 네임스페이스·세션 쌍방 필수 + 재사용 확인 + 한글 + 레지스트리 저장
