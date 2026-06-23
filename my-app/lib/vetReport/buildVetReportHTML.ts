// ─────────────────────────────────────────────────────────────────────────────
// Pure HTML renderer for the "Pet Health Summary" PDF.
//
// Takes a fully-assembled VetReportData and returns a self-contained HTML
// string (inline CSS, A4) that expo-print converts to a PDF. Pure and
// side-effect free so it can be unit-tested in node.
//
// Colours come from the design tokens (no ad-hoc hex). Fonts use a neutral
// system stack — the brand display/Montserrat files aren't embedded in the PDF
// renderer, and a clinical handout reads best in a clean sans-serif.
// ─────────────────────────────────────────────────────────────────────────────

import { color } from '../../constants/design';
import type {
  VetReportData,
  Medication,
  Vaccination,
  WeightHistoryEntry,
  DietItem,
  RecentVetVisit,
} from './types';

/** Escape text destined for HTML body/attribute content. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A value or a graceful em-dash placeholder. */
function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return esc(value);
}

const FONT_STACK =
  "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function bcsScaleNote(bcs: number | null): string {
  if (bcs === null) return '';
  let verdict = 'ideal';
  if (bcs <= 3) verdict = 'underweight';
  else if (bcs >= 6) verdict = 'overweight';
  return ` <span class="muted">(1–9 scale · ${esc(verdict)})</span>`;
}

function sexLabel(sex: string | null, isNeutered: boolean | null): string {
  if (!sex) return '—';
  const neuter =
    isNeutered === null ? '' : isNeutered ? ' · neutered' : ' · intact';
  return `${esc(sex)}${neuter}`;
}

/** A two-column key/value row. */
function row(label: string, value: string): string {
  return `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
}

/** Render a list of chips, or a muted "None recorded". */
function chips(items: string[], emptyLabel = 'None recorded'): string {
  if (!items || items.length === 0) {
    return `<span class="muted">${esc(emptyLabel)}</span>`;
  }
  return items.map((i) => `<span class="chip">${esc(i)}</span>`).join(' ');
}

function dietRows(diet: DietItem[]): string {
  if (!diet || diet.length === 0) {
    return `<tr><td colspan="3" class="muted">No food logged in the pantry.</td></tr>`;
  }
  return diet
    .map(
      (d) =>
        `<tr>
          <td>${d.isPrimary ? '<strong>★ </strong>' : ''}${esc(d.productName)}</td>
          <td>${orDash(d.brand)}</td>
          <td>${orDash(d.foodType)}</td>
        </tr>`
    )
    .join('');
}

function weightRows(history: WeightHistoryEntry[]): string {
  if (!history || history.length === 0) {
    return `<tr><td colspan="3" class="muted">No weight history logged yet.</td></tr>`;
  }
  return history
    .map(
      (w) =>
        `<tr>
          <td>${esc(w.date)}</td>
          <td>${esc(w.weightKg)} kg</td>
          <td>${orDash(w.notes)}</td>
        </tr>`
    )
    .join('');
}

function medRows(meds: Medication[]): string {
  if (!meds || meds.length === 0) {
    return `<tr><td colspan="2" class="muted">None recorded</td></tr>`;
  }
  return meds
    .map((m) => `<tr><td>${esc(m.name)}</td><td>${orDash(m.dosage)}</td></tr>`)
    .join('');
}

function vaccineRows(vaccines: Vaccination[]): string {
  if (!vaccines || vaccines.length === 0) {
    return `<tr><td colspan="2" class="muted">None recorded</td></tr>`;
  }
  return vaccines
    .map((v) => `<tr><td>${esc(v.name)}</td><td>${orDash(v.date)}</td></tr>`)
    .join('');
}

function vetHistoryBlock(history: RecentVetVisit[]): string {
  if (!history || history.length === 0) {
    return `<p class="muted">No previous vet reports on file.</p>`;
  }
  return history
    .map((v) => {
      const meds = v.medications.length
        ? v.medications
            .map((m) => `${esc(m.name)}${m.dosage ? ` (${esc(m.dosage)})` : ''}`)
            .join(', ')
        : '—';
      const dx = v.diagnoses.length ? v.diagnoses.map(esc).join(', ') : '—';
      return `<div class="visit">
          <div class="visit-date">${esc(v.date)}</div>
          <div class="visit-line"><span class="visit-label">Diagnoses</span> ${dx}</div>
          <div class="visit-line"><span class="visit-label">Medications</span> ${meds}</div>
          ${
            v.nextAppointment
              ? `<div class="visit-line"><span class="visit-label">Next visit</span> ${esc(
                  v.nextAppointment
                )}</div>`
              : ''
          }
        </div>`;
    })
    .join('');
}

export function buildVetReportHTML(data: VetReportData): string {
  const { signalment: s, owner, vitals: v, weekly: w } = data;

  const photo = data.petPhotoDataUri
    ? `<img class="photo" src="${data.petPhotoDataUri}" alt="" />`
    : `<div class="photo photo-empty">${esc(
        (s.name || '?').charAt(0).toUpperCase()
      )}</div>`;

  const treatLine =
    w.treatCaloriesPercent !== null
      ? `${esc(w.treatCaloriesPercent)}% of weekly calories from treats`
      : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: ${FONT_STACK};
    color: ${color.ink};
    margin: 0;
    padding: 32px 36px 48px;
    font-size: 12px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .wordmark {
    font-size: 13px; letter-spacing: 3px; font-weight: 700; color: ${color.navy};
  }
  header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 3px solid ${color.yellow}; padding-bottom: 14px; margin-bottom: 4px;
  }
  h1 { font-size: 22px; margin: 6px 0 2px; color: ${color.navy}; letter-spacing: -0.3px; }
  .gen-date { font-size: 11px; color: ${color.slateMuted}; text-align: right; }
  .disclaimer {
    font-size: 10px; color: ${color.slateMuted}; margin: 8px 0 22px;
    font-style: italic;
  }
  section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 {
    font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase;
    color: ${color.slateFaint}; margin: 0 0 8px; border-bottom: 1px solid ${color.hairline};
    padding-bottom: 5px;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 6px; vertical-align: top; }
  th {
    font-weight: 600; color: ${color.slate}; width: 32%; font-size: 11px;
  }
  .data-table th, .data-table td {
    border-bottom: 1px solid ${color.hairline}; font-size: 11.5px;
  }
  .data-table thead th {
    color: ${color.slateFaint}; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.6px; width: auto;
  }
  .signalment { display: flex; gap: 18px; align-items: flex-start; }
  .signalment table { flex: 1; }
  .photo {
    width: 84px; height: 84px; border-radius: 12px; object-fit: cover;
    border: 1px solid ${color.hairline};
  }
  .photo-empty {
    display: flex; align-items: center; justify-content: center;
    background: ${color.surfaceSubtle}; color: ${color.slateFaint};
    font-size: 34px; font-weight: 700;
  }
  .chip {
    display: inline-block; background: ${color.surfaceSubtle};
    border: 1px solid ${color.hairline}; border-radius: 999px;
    padding: 2px 10px; font-size: 11px; margin: 0 4px 4px 0; color: ${color.ink};
  }
  .muted { color: ${color.slateFaint}; }
  .stat-grid { display: flex; gap: 10px; }
  .stat {
    flex: 1; background: ${color.surfaceSubtle}; border-radius: 10px;
    padding: 10px 12px; border: 1px solid ${color.hairline};
  }
  .stat-val { font-size: 18px; font-weight: 700; color: ${color.navy}; }
  .stat-lbl { font-size: 10px; color: ${color.slateMuted}; margin-top: 2px; }
  .visit { padding: 8px 0; border-bottom: 1px solid ${color.hairline}; }
  .visit:last-child { border-bottom: none; }
  .visit-date { font-weight: 700; color: ${color.ink}; margin-bottom: 2px; }
  .visit-line { font-size: 11.5px; color: ${color.slate}; }
  .visit-label { font-weight: 600; color: ${color.ink}; }
  .reason-box {
    background: ${color.surfaceSubtle}; border-left: 3px solid ${color.yellow};
    border-radius: 0 8px 8px 0; padding: 12px 14px; font-size: 12px;
    color: ${color.ink}; white-space: pre-wrap;
  }
  footer {
    margin-top: 28px; border-top: 1px solid ${color.hairline}; padding-top: 10px;
    font-size: 10px; color: ${color.slateFaint}; text-align: center;
  }
</style>
</head>
<body>
  <header>
    <div>
      <div class="wordmark">PAWTCHI</div>
      <h1>Pet Health Summary</h1>
    </div>
    <div class="gen-date">Generated<br/>${esc(data.generatedAt)}</div>
  </header>
  <div class="disclaimer">
    Owner-prepared summary generated via the Pawtchi app from at-home logs and
    previously scanned records. This is not a veterinary diagnosis.
  </div>

  <section>
    <h2>Patient</h2>
    <div class="signalment">
      <table>
        ${row('Name', orDash(s.name))}
        ${row('Species', orDash(s.species))}
        ${row('Breed', orDash(s.breed))}
        ${row('Sex', sexLabel(s.sex, s.isNeutered))}
        ${row('Age', orDash(s.ageLabel))}
        ${row('Microchip', orDash(s.microchip))}
        ${row('Owner', orDash(owner.name))}
        ${row('Contact', orDash(owner.email))}
      </table>
      ${photo}
    </div>
  </section>

  <section>
    <h2>Current vitals</h2>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-val">${
          v.currentWeightKg !== null ? `${esc(v.currentWeightKg)} kg` : '—'
        }</div>
        <div class="stat-lbl">Current weight</div>
      </div>
      <div class="stat">
        <div class="stat-val">${
          v.targetWeightKg !== null ? `${esc(v.targetWeightKg)} kg` : '—'
        }</div>
        <div class="stat-lbl">Target weight</div>
      </div>
      <div class="stat">
        <div class="stat-val">${v.bcs !== null ? `${esc(v.bcs)}/9` : '—'}</div>
        <div class="stat-lbl">Body condition${bcsScaleNote(v.bcs)}</div>
      </div>
      <div class="stat">
        <div class="stat-val">${orDash(v.activityLevel)}</div>
        <div class="stat-lbl">Activity level</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Weight history</h2>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Weight</th><th>Notes</th></tr></thead>
      <tbody>${weightRows(data.weightHistory)}</tbody>
    </table>
  </section>

  <section>
    <h2>Diet &amp; nutrition</h2>
    <table class="data-table">
      <thead><tr><th>Food</th><th>Brand</th><th>Type</th></tr></thead>
      <tbody>${dietRows(data.diet)}</tbody>
    </table>
    <table style="margin-top:10px">
      ${row(
        'Daily calorie target',
        w.targetDailyCalories !== null ? `${esc(w.targetDailyCalories)} kcal` : '—'
      )}
      ${row(
        '7-day average intake',
        w.avgDailyCalories !== null ? `${esc(w.avgDailyCalories)} kcal/day` : '—'
      )}
      ${row(
        'Water (7-day avg)',
        w.avgWaterMl !== null
          ? `${esc(w.avgWaterMl)} ml/day${
              w.waterTargetMl !== null ? ` of ${esc(w.waterTargetMl)} ml target` : ''
            }`
          : '—'
      )}
      ${row(
        'Activity (7-day avg)',
        w.avgActivityMinutes !== null ? `${esc(w.avgActivityMinutes)} min/day` : '—'
      )}
      ${treatLine ? row('Treats', treatLine) : ''}
    </table>
  </section>

  <section>
    <h2>Allergies &amp; conditions</h2>
    <table>
      ${row('Allergies', chips(data.allergies))}
      ${row('Medical conditions', chips(data.conditions))}
    </table>
  </section>

  <section>
    <h2>Current medications</h2>
    <table class="data-table">
      <thead><tr><th>Medication</th><th>Dosage</th></tr></thead>
      <tbody>${medRows(data.medications)}</tbody>
    </table>
  </section>

  <section>
    <h2>Vaccinations</h2>
    <table class="data-table">
      <thead><tr><th>Vaccine</th><th>Date</th></tr></thead>
      <tbody>${vaccineRows(data.vaccinations)}</tbody>
    </table>
  </section>

  <section>
    <h2>Recent vet history</h2>
    ${vetHistoryBlock(data.recentVetHistory)}
  </section>

  <section>
    <h2>Reason for this visit</h2>
    ${
      data.reason && data.reason.trim()
        ? `<div class="reason-box">${esc(data.reason)}</div>`
        : `<p class="muted">No reason or concerns noted.</p>`
    }
  </section>

  <footer>
    Generated by Pawtchi · ${esc(data.generatedAt)} · Notice everything
  </footer>
</body>
</html>`;
}
