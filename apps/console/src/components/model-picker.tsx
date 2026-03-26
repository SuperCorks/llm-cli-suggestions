"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ModelMetadataChips } from "@/components/model-metadata-chips";
import type { OllamaModelOption } from "@/lib/types";

interface BaseModelPickerProps {
  label: string;
  options: OllamaModelOption[];
  placeholder: string;
  helperText?: ReactNode;
  installedOnly?: boolean;
  emptyMessage?: ReactNode;
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
  requireKnownOption?: boolean;
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
  const [validationMessage, setValidationMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.setAttribute("autocomplete", "off");
    inputRef.current.setAttribute("autocorrect", "off");
    inputRef.current.setAttribute("autocapitalize", "none");
    inputRef.current.spellcheck = false;
  }, []);

  const selectableOptions = useMemo(
    () =>
      props.installedOnly
        ? props.options.filter((option) => option.installed)
        : props.options.filter((option) => !option.remoteOnly),
    [props.installedOnly, props.options],
  );
  const filteredOptions = useMemo(() => {
    const normalizedSelected =
      props.mode === "multi"
        ? props.selected.map((value) => value.trim().toLowerCase())
        : props.value.trim()
          ? [props.value.trim().toLowerCase()]
          : [];
    const normalizedInput =
      props.mode === "multi"
        ? props.inputValue.trim().toLowerCase()
        : props.value.trim().toLowerCase();

    return [...selectableOptions]
      .sort((left, right) => {
        if (left.installed !== right.installed) {
          return left.installed ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .filter((option) => !normalizedSelected.includes(option.name.toLowerCase()))
      .filter((option) =>
        normalizedInput === "" ? true : option.name.toLowerCase().includes(normalizedInput),
      );
  }, [props, selectableOptions]);

  const inputValue = props.mode === "multi" ? props.inputValue : props.value;

  function resolveKnownOption(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return selectableOptions.find((option) => option.name.toLowerCase() === normalized) || null;
  }

  const canCommitMultiValue =
    props.mode === "multi"
      ? Boolean(
          props.inputValue.trim() &&
            (props.requireKnownOption ? resolveKnownOption(props.inputValue) : true),
        )
      : false;

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
      const knownOption = resolveKnownOption(normalized);
      if (props.requireKnownOption && !knownOption) {
        setValidationMessage("Choose an exact model from the list before adding it.");
        setIsOpen(true);
        return;
      }

      props.onAdd(knownOption?.name || normalized);
      props.onInputChange("");
      setValidationMessage("");
      return;
    }

    props.onValueChange(normalized);
    props.onSelect?.(normalized);
    setValidationMessage("");
  }

  function clearSelection() {
    if (props.mode !== "multi") {
      return;
    }

    props.onClearAll();
    setIsOpen(false);
    setValidationMessage("");
  }

  function selectOption(optionName: string) {
    if (props.mode === "multi") {
      props.onAdd(optionName);
      props.onInputChange("");
    } else {
      props.onValueChange(optionName);
      props.onSelect?.(optionName);
    }
    setIsOpen(false);
    setValidationMessage("");
  }

  return (
    <div className="stack-sm">
      <label htmlFor={inputId}>{props.label}</label>
      <div
        className="model-picker"
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
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
            onMouseDown={(event) => {
              if (document.activeElement === inputRef.current) {
                event.preventDefault();
                setIsOpen((current) => !current);
              }
            }}
            onFocus={() => {
              setIsOpen(true);
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (props.mode === "multi") {
                props.onInputChange(nextValue);
              } else {
                props.onValueChange(nextValue);
              }
              setValidationMessage("");
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
                disabled={!canCommitMultiValue}
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
                <span className="model-picker-option-meta">
                  <ModelMetadataChips
                    model={option}
                    showRemoteStatus
                  />
                </span>
              </button>
            ))}
          </div>
        ) : isOpen ? (
          <div className="model-picker-menu model-picker-menu-empty" role="status">
            {props.emptyMessage || "No matching models. Keep typing or pick from the Ollama inventory."}
          </div>
        ) : null}
      </div>
      {props.helperText ? <p className="helper-text">{props.helperText}</p> : null}
      {props.mode === "multi" && validationMessage ? (
        <p className="error-text">{validationMessage}</p>
      ) : null}
      {props.mode === "multi" && props.selected.length > 0 ? (
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
