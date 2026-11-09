/**
 * 자연어 입력 영역. 해석 결과는 여기서 처리하지 않는다:
 * 완전한 조건은 '내 조건'에 바로 반영되고, 확인이 필요한 것은 생성 버튼 바로 위 '확인할 조건'에 모인다.
 */
import { useState } from "react";
import type { NlState } from "../../app/state";
import { Alert, Badge, Button, Icon } from "../../ui";

/** 예시는 현재 지원하는 조건만. 누르면 입력창만 채운다(API 자동 호출 없음). */
const EXAMPLES = ["15~18학점으로, 금요일은 가능하면 비워 주세요.", "주 4일만 등교하고 싶어요.", "오후 6시 이후 수업은 피하고 싶어요."];

interface Props {
  nl: NlState;
  parseMode: "live" | "fixture" | "unavailable" | null;
  onParse: (text: string) => void;
  onGoReview: () => void;
}

export function NlPanel({ nl, parseMode, onParse, onGoReview }: Props) {
  const [text, setText] = useState("");
  const sum = nl.lastSummary;
  const modeBadge =
    parseMode === "fixture" ? (
      <span data-testid="demo-badge">
        <Badge tone="warning" title="LLM이 아닌 규칙 기반 데모 해석기입니다. 등록된 문형만 해석합니다.">
          데모 해석(규칙 기반, LLM 아님)
        </Badge>
      </span>
    ) : parseMode === "live" ? (
      <span className="badge live success">
        <Icon name="sparkle" size={13} /> Gemini 해석
      </span>
    ) : null;

  return (
    <div className="nl-box" data-testid="nl-panel">
      <div className="row between">
        <h2>어떤 시간표를 원하세요?</h2>
        {modeBadge}
      </div>
      {parseMode === "unavailable" ? (
        <Alert tone="info" title="자연어 해석기가 설정되지 않았어요">
          아래 ‘직접 조건 추가’로 조건을 입력하면 시간표를 만들 수 있습니다.
        </Alert>
      ) : (
        <>
          <label className="field" htmlFor="nl-input">
            원하는 조건을 문장으로 적어 주세요 (학번·성적 같은 개인정보는 적지 마세요)
          </label>
          <textarea
            id="nl-input"
            rows={3}
            maxLength={2000}
            value={text}
            placeholder="예: 15~18학점으로, 금요일은 가능하면 비워 주세요."
            onChange={(e) => setText(e.target.value)}
            data-testid="nl-input"
          />
          <div className="examples" aria-label="입력 예시">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div className="row">
            <Button onClick={() => onParse(text)} disabled={!text.trim() || nl.status === "parsing"} data-testid="nl-parse">
              {nl.status === "parsing" ? "해석하고 있어요…" : "조건으로 바꾸기"}
            </Button>
          </div>
        </>
      )}

      {nl.error && (
        <div data-testid="nl-error">
          <Alert tone="danger" title="자연어 해석에 실패했어요">
            {nl.error}
          </Alert>
        </div>
      )}

      {sum && nl.status === "done" && (
        <div className="stack" data-testid="nl-result" role="status">
          {nl.response?.provider_mode === "fixture" && <p className="xs muted">※ 데모 해석 결과입니다.</p>}
          <p className="small">
            해석 결과: <b>반영 {sum.added}개</b>
            {sum.pending + sum.unsupported > 0 && (
              <>
                {" "}
                · <b className="warn">확인 필요 {sum.pending + sum.unsupported}개</b>
              </>
            )}
          </p>
          {nl.response?.warnings.map((w, i) => (
            <p key={i} className="xs muted">
              {w}
            </p>
          ))}
          {nl.notes.map((n, i) => (
            <p key={`n${i}`} className="xs muted">
              {n}
            </p>
          ))}
          {sum.pending + sum.unsupported > 0 && (
            <div>
              <Button size="sm" variant="secondary" onClick={onGoReview} data-testid="go-review">
                확인할 조건으로 이동
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
