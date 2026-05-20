import React from "react";
import type { QuestionRequest } from "../../types";
import type { QuestionAnswerDraft } from "../../types/internal";

export function QuestionCard({
  question,
  draft,
  responding,
  onToggleOption,
  onCustomValueChange,
  onSubmit,
  onReject,
}: {
  question: QuestionRequest;
  draft: QuestionAnswerDraft;
  responding: boolean;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
  onCustomValueChange: (questionIndex: number, value: string) => void;
  onSubmit: () => void;
  onReject: () => void;
}) {
  return (
    <article className="question-card">
      <header>
        <strong>Input requested</strong>
        <span>{question.id}</span>
      </header>
      <div className="question-card-body">
        {(question.questions ?? []).map((info, questionIndex) => {
          const selectedValues = draft.optionSelections[questionIndex] ?? [];
          const customValue = draft.customValues[questionIndex] ?? "";
          return (
            <div key={`${question.id}:${questionIndex}`} className="question-block">
              <div className="question-block-head">
                <strong>{info.header}</strong>
                <small>{info.question}</small>
              </div>
              <div className="question-options">
                {info.options.map((option, optionIndex) => {
                  const letter = String.fromCharCode(65 + optionIndex);
                  const selected = selectedValues.includes(option.label);
                  return (
                    <label key={option.label} className={`question-option ${selected ? "selected" : ""}`}>
                      <input
                        type={info.multiple ? "checkbox" : "radio"}
                        name={`${question.id}:${questionIndex}`}
                        checked={selected}
                        onChange={() => onToggleOption(questionIndex, option.label, Boolean(info.multiple))}
                      />
                      <span>
                        <strong>({letter}) {option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              {info.custom !== false ? (
                <input
                  className="question-custom-input"
                  value={customValue}
                  onChange={(event) => onCustomValueChange(questionIndex, event.currentTarget.value)}
                  placeholder="Type your own answer"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="question-actions">
        <button type="button" onClick={onSubmit} disabled={responding}>
          {responding ? "Submitting..." : "Submit"}
        </button>
        <button type="button" className="danger" onClick={onReject} disabled={responding}>
          Dismiss
        </button>
      </div>
    </article>
  );
}
