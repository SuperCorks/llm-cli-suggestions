"use client";

import { X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import type { OllamaModelOption } from "@/lib/types";

interface BaseModelPickerProps {
  label: string;
  options: OllamaModelOption[];
  placeholder: string;
  helperText?: string;
}

interface MultiModelPickerProps extends BaseModelPickerProps {
  mode: "multi";
  selected: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: (value?: string) => void;
  onRemove: (value: string) => void;
  onClearAll: () => void;
  actionLabel?: string;
}

interface SingleModelPickerProps extends BaseModelPickerProps {
  mode: "single";
  value: string;
  onValueChange: (value: string) => void;
  onSelect?: (value: string) => void;
}

type ModelPickerProps = MultiModelPickerProps | SingleModelPickerProps;

export function ModelPicker(props: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const filteredOptions = useMemo(() => {
    const selectedNames =
      props.mode === "multi"
        ? props.selected
        : props.value.trim()
          ? [props.value.trim()]
          : [];
    const normalizedInput =
      props.mode === "multi"
        ? props.inputValue.trim().toLowerCase()
        : props.value.trim().toLowerCase();

    return props.options
      .filter((option) => !selectedNames.includes(option.name))
      .filter((option) =>
        normalizedInput === "" ? true : option.name.toLowerCase().includes(normalizedInput),
      );
  }, [props]);

  const multiSelectionSummary =
    props.mode === "multi"
      ? props.selected.length <= 1
        ? props.selected[0] || ""
        : `${props.selected[0]} +${props.selected.length - 1} more`
      : "";

  const inputValue =
    props.mode === "multi"
      ? isEditing
        ? props.inputValue
        : props.inputValue || multiSelectionSummary
      : props.value;

  function commitValue(explicitValue?: string) {
    const rawValue =
      explicitValue ??
      inputRef.current?.value ??
      (props.mode === "multi" ? props.inputValue : props.value);
    const normalized = rawValue.trim();
    if (!normalized) {
      return;
    }

    if (props.mode === "multi") {
      props.onAdd(normalized);
      setIsEditing(false);
      return;
    }

    props.onValueChange(normalized);
    props.onSelect?.(normalized);
  }

  function clearSelection() {
    if (props.mode !== "multi") {
      return;
    }

    props.onClearAll();
    setIsEditing(false);
    setIsOpen(false);
  }

  function selectOption(optionName: string) {
    if (props.mode === "multi") {
      props.onAdd(optionName);
    } else {
      props.onValueChange(optionName);
      props.onSelect?.(optionName);
    }
    setIsOpen(false);
    setIsEditing(false);
  }

  return (
    <div className="stack-sm">
      <label htmlFor={inputId}>{props.label}</label>
      <div
        className="model-picker"
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setIsEditing(false);
          }, 120);
        }}
      >
        <div
          className={
            props.mode === "multi" ? "model-picker-row" : "model-picker-row model-picker-row-single"
          }
        >
          <input
            id={inputId}
            ref={inputRef}
            value={inputValue}
            onFocus={() => {
              setIsOpen(true);
              if (props.mode === "multi") {
                setIsEditing(true);
              }
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (props.mode === "multi") {
                props.onInputChange(nextValue);
              } else {
                props.onValueChange(nextValue);
              }
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitValue();
                setIsOpen(false);
              }
              if (event.key === "Escape") {
                setIsOpen(false);
                setIsEditing(false);
              }
            }}
            placeholder={props.placeholder}
          />
          {props.mode === "multi" ? (
            <div className="model-picker-actions">
              {props.selected.length > 0 ? (
                <button
                  type="button"
                  className="button-secondary"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    clearSelection();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      clearSelection();
                    }
                  }}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="button-secondary"
                onMouseDown={(event) => {
                  event.preventDefault();
                  commitValue();
                  setIsOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    commitValue();
                    setIsOpen(false);
                  }
                }}
              >
                {props.actionLabel || "Add"}
              </button>
            </div>
          ) : null}
        </div>
        {isOpen && filteredOptions.length > 0 ? (
          <div className="model-picker-menu" role="listbox" aria-label={`${props.label} options`}>
            {filteredOptions.map((option) => (
              <button
                key={`${option.source}-${option.name}`}
                type="button"
                role="option"
                aria-selected="false"
                className="model-picker-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option.name);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectOption(option.name);
                  }
                }}
              >
                <span className="model-picker-option-name">{option.name}</span>
                <span
                  className={
                    option.installed
                      ? "model-status-chip model-status-chip-installed"
                      : "model-status-chip model-status-chip-available"
                  }
                >
                  {option.installed ? "installed" : "available"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {props.helperText ? <p className="helper-text">{props.helperText}</p> : null}
      {props.mode === "multi" && props.selected.length > 1 ? (
        <div className="chip-list">
          {props.selected.map((modelName) => {
            const option = props.options.find((candidate) => candidate.name === modelName);
            return (
              <span
                key={modelName}
                className={option?.installed ? "model-chip-tag installed" : "model-chip-tag"}
              >
                <span>{modelName}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => props.onRemove(modelName)}
                  aria-label={`Remove ${modelName}`}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
