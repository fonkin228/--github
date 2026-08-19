import { useEffect, useState } from 'react';
import { normalizeParams } from '@shared/calc';
import { round } from '@shared/money';
import { parseAmount, parsePercent } from '@shared/parse';
import { DEFAULT_PARAMS, P3_BASES, p3BaseLabel, p3BaseShortLabel, type P3Base, type Params } from '@shared/types';

interface Props {
  params: Params;
  onChange(params: Params): void;
  onSave(params: Params): Promise<void>;
}

/** Внутри формы проценты живут как «89», а не «0.89» — так привычнее. */
const toForm = (p: Params) => ({
  p1: String(round(p.p1 * 100, 4)),
  p2: String(round(p.p2 * 100, 4)),
  p3: String(round(p.p3 * 100, 4)),
  step: String(p.step),
  commissionRate: String(round(p.commissionRate * 100, 4)),
  p3Base: p.p3Base as P3Base,
});

export function ParamsTab({ params, onChange, onSave }: Props) {
  const [form, setForm] = useState(toForm(params));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(toForm(params)), [params]);

  const build = (next: ReturnType<typeof toForm>): Params | null => {
    const p1 = parsePercent(next.p1);
    const p2 = parsePercent(next.p2);
    const p3 = parsePercent(next.p3);
    const step = parseAmount(next.step);
    const fee = parsePercent(next.commissionRate);
    if (!p1.ok || !p2.ok || !p3.ok || !step.ok || step.value <= 0 || !fee.ok) return null;
    return normalizeParams({
      p1: p1.value,
      p2: p2.value,
      p3: p3.value,
      step: step.value,
      commissionRate: fee.value,
      p3Base: next.p3Base,
    });
  };

  const update = (patch: Partial<ReturnType<typeof toForm>>): void => {
    const next = { ...form, ...patch };
    setForm(next);
    setStatus(null);
    const built = build(next);
    if (built) onChange(built);
  };

  const handleSave = async (): Promise<void> => {
    const built = build(form);
    if (!built) {
      setStatus('Проверьте значения: проценты 0–100, шаг больше нуля.');
      return;
    }
    setSaving(true);
    try {
      await onSave(built);
      setStatus('Сохранено — бот и экспорт теперь используют эти параметры.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const invalid = build(form) === null;

  return (
    <div className="tab">
      <p className="hint">
        Меняются здесь — и сразу подхватываются расчётом на всех вкладках и выгрузкой в Excel.
      </p>

      <Field
        label="Доля 1 — % от N"
        note="округляется вверх до шага"
        value={form.p1}
        suffix="%"
        onChange={(v) => update({ p1: v })}
      />
      <Field
        label="Доля 2 — % от исходной N"
        note="без округления"
        value={form.p2}
        suffix="%"
        onChange={(v) => update({ p2: v })}
      />
      <Field
        label="Доля 3"
        note={`% от «${p3BaseLabel(form.p3Base)}»`}
        value={form.p3}
        suffix="%"
        onChange={(v) => update({ p3: v })}
      />

      <div className="field">
        <label className="field__label">
          База для доли 3<span className="field__note">от чего считать 4%</span>
        </label>
        <div className="segmented">
          {P3_BASES.map((base) => (
            <button
              key={base}
              type="button"
              className={form.p3Base === base ? 'is-active' : ''}
              onClick={() => update({ p3Base: base })}
            >
              {p3BaseShortLabel(base)}
            </button>
          ))}
        </div>
        <span className="field__note">
          {form.p3Base === 'nMinusRoundUp'
            ? 'Из суммы вычитается добавка от округления вверх, и уже от разницы берётся процент.'
            : form.p3Base === 'n'
              ? 'Процент от введённой суммы как есть.'
              : 'Процент от округлённого результата п.1 — так считала первая версия таблицы.'}
        </span>
      </div>

      <Field label="Шаг округления вверх" value={form.step} onChange={(v) => update({ step: v })} />
      <div className="chips">
        {[100, 500, 1000, 5000, 10000].map((step) => (
          <button key={step} type="button" className="chip" onClick={() => update({ step: String(step) })}>
            {step.toLocaleString('ru-RU')}
          </button>
        ))}
      </div>

      <Field
        label="Комиссия за пополнение"
        note="вычитается из отмеченных поступлений на этапе 1"
        value={form.commissionRate}
        suffix="%"
        onChange={(v) => update({ commissionRate: v })}
      />

      {status ? <div className="notice">{status}</div> : null}

      <div className="row-buttons">
        <button className="btn btn--primary" onClick={handleSave} disabled={saving || invalid}>
          {saving ? 'Сохраняю…' : 'Сохранить параметры'}
        </button>
        <button className="btn" onClick={() => update(toForm(DEFAULT_PARAMS))}>
          Сбросить к 89 / 7 / 4
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  note,
  value,
  suffix,
  onChange,
}: {
  label: string;
  note?: string;
  value: string;
  suffix?: string;
  onChange(value: string): void;
}) {
  return (
    <div className="field">
      <label className="field__label">
        {label}
        {note ? <span className="field__note">{note}</span> : null}
      </label>
      <div className="field__control">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        {suffix ? <span className="field__suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}
