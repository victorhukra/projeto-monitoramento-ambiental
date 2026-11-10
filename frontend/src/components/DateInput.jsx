import { useRef, useState } from 'react';
import { fmtDataIso } from '../lib/format.js';

const formatDateInput = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

function parseDateInput(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text ?? '');
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText), month = Number(monthText), year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

const mascarar = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export default function DateInput({ id, value = '', min, max, onChange, label, ...props }) {
  const calendar = useRef(null);
  const [draft, setDraft] = useState(() => ({ source: value, text: formatDateInput(value) }));
  const text = draft.source === value ? draft.text : formatDateInput(value);
  const parsed = parseDateInput(text);
  const foraDoLimite = Boolean(parsed && ((min && parsed < min) || (max && parsed > max)));
  const dataInvalida = Boolean(text.length === 10 && !parsed);
  const periodoPermitido = min && max ? `entre ${fmtDataIso(min)} e ${fmtDataIso(max)}`
    : min ? `a partir de ${fmtDataIso(min)}` : `até ${fmtDataIso(max)}`;
  const erro = foraDoLimite
    ? `Escolha uma data ${periodoPermitido}.`
    : dataInvalida ? 'Data inválida. Use o formato dd/mm/aaaa.' : null;
  const describedBy = [props['aria-describedby'], erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;

  function atualizarTexto(event) {
    const nextText = mascarar(event.target.value);
    const nextDate = parseDateInput(nextText);
    const nextValue = nextDate && !(min && nextDate < min) && !(max && nextDate > max) ? nextDate : '';
    setDraft({ source: nextValue, text: nextText });
    onChange(nextValue);
  }

  function selecionarCalendario(event) {
    const nextValue = event.target.value;
    setDraft({ source: nextValue, text: formatDateInput(nextValue) });
    onChange(nextValue);
  }

  function abrirCalendario() {
    try {
      if (calendar.current?.showPicker) calendar.current.showPicker();
      else { calendar.current?.focus(); calendar.current?.click(); }
    } catch {
      calendar.current?.focus();
      calendar.current?.click();
    }
  }

  return (
    <>
      <div className="date-input">
        <input
          {...props}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/aaaa"
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          maxLength={10}
          value={text}
          onChange={atualizarTexto}
          aria-invalid={props['aria-invalid'] ?? Boolean(erro)}
          aria-describedby={describedBy}
        />
        <button className="date-calendar" type="button" onClick={abrirCalendario} aria-label={`Abrir calendário${label ? `: ${label}` : ''}`} title="Abrir calendário" disabled={props.disabled}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>
        </button>
        <input
          ref={calendar}
          className="date-native-picker"
          type="date"
          lang="pt-BR"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          min={min}
          max={max}
          disabled={props.disabled}
          onChange={selecionarCalendario}
        />
      </div>
      {erro && <p className="campo-erro date-input-error" id={`${id}-erro`}>{erro}</p>}
    </>
  );
}
