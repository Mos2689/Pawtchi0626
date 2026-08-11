/**
 * The Pawtchi email template — a block renderer, not a page layout.
 *
 * ── Why this is a string builder and not React Email ────────────────────────
 *
 * The previous template used @react-email/components. That is a pleasant way to
 * write a simple email and the wrong tool for this one. This design needs exact
 * table markup — bleed photos against hairline-divided stat columns, an
 * overlapping card, Outlook conditional wrappers — and every layer of
 * abstraction between the author and the `<td>` makes that harder to control
 * and harder to diff when a client renders it wrong. Hand-authored tables are
 * the norm for design-led email for exactly this reason.
 *
 * It also removes three npm specifiers from the edge function's cold start.
 *
 * ── The client constraints this markup is shaped by ─────────────────────────
 *
 * Not stylistic preferences. Each of these is a client that will break:
 *
 *   - **Tables, not flexbox or grid.** Outlook renders through Word, which
 *     supports neither. Every row here is a table.
 *   - **No SVG.** Gmail strips it entirely. Anything circular or drawn is
 *     either a hosted PNG or made from table cells and borders.
 *   - **Inline styles only.** Gmail discards <style> blocks in several
 *     contexts, and strips classes.
 *   - **Georgia is the real display face.** Outlook and Android Gmail do not
 *     load webfonts, so the serif stack must look right in Georgia rather than
 *     treat it as degradation. Georgia is a genuinely good transitional serif;
 *     the design was checked in it.
 *   - **Images are blocked by default** in many clients on first open, so no
 *     text is ever baked into an image and every img carries real alt text.
 *   - **Under 102 KB.** Gmail clips the message past that and hides the
 *     unsubscribe footer, which is both a UX and a compliance problem.
 *
 * Keep this file import-free apart from sibling pure modules so both runtimes
 * compile it and the byte mirror holds.
 */

// ── Brand tokens ────────────────────────────────────────────────────────────
// Duplicated from constants/design.ts rather than imported: that module pulls
// in react-native's Platform and cannot be compiled by Deno. The warm palette
// below is the email surface specifically — it is not the app's navy/white
// two-surface system, and it should not be copied back into the app.

export const EMAIL_COLOR = {
  /** Page ground. Warm, not white — white reads clinical at this scale. */
  cream: '#F7F5F0',
  /** The card the content sits on, a shade warmer than pure white. */
  card: '#FFFDFA',
  /** Soft fill for quote blocks and tip cards. */
  sunken: '#F7F5F0',
  ink: '#1A1A1A',
  body: '#5C574E',
  /** Warm grey for eyebrows and captions. Passes AA on cream at 4.8:1. */
  muted: '#8A8578',
  hairline: '#EFEBE2',
  /** The CTA pill. Softer than the app's electric #F7F602. */
  yellow: '#FFE14D',
  /** Deltas and inline links. Yellow is never ink; this is its readable cousin. */
  amber: '#A87F14',
} as const;

/**
 * ── Type ────────────────────────────────────────────────────────────────────
 *
 * Georgia carries the display and every numeral, and that is a typographic
 * choice rather than a fallback. Georgia was drawn with **old-style figures** —
 * numerals of varying height with ascenders and descenders, rather than the
 * uniform lining digits a UI face uses. That is exactly why "18.4" and "7" read
 * as editorial here instead of as dashboard output, and it is most of the
 * character in the reference design. A geometric sans would flatten it.
 *
 * Geist is the app's typeface (`@expo-google-fonts/geist`) and is layered on
 * the sans stack as **progressive enhancement only**. Gmail strips `@font-face`
 * on every platform, as do Outlook for Windows and Yahoo, so a webfont reaches
 * roughly Apple Mail, Outlook for Mac and Samsung Mail and no one else. Making
 * it load-bearing would mean designing for a face most recipients never see —
 * so the design is checked in the fallback, and Geist is a bonus where it lands.
 */
const SERIF = `Georgia,'Times New Roman',Times,serif`;
const SANS = `'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

// ── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Which photograph a slot wants. The sender resolves this to a URL, because
 * only it knows whether the owner has a real upload — see
 * `pawtchi-website/public/email/README.md` for why `unsplash` counts as absent.
 */
export type PhotoIntent =
  /** The owner's animal, named in nearby copy. Falls back to the faceless default. */
  | 'pet'
  /** Atmosphere. Any default is safe because no copy points at it. */
  | 'mood';

export type EmailBlock =
  /** Serif display headline. One per email, at the top. */
  | { kind: 'hero'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'eyebrow'; text: string }
  /** Photo beside a stat column — the signature weekly-summary composition. */
  | {
      kind: 'photoStats';
      photo: { intent: PhotoIntent; alt: string };
      stats: { value: string; unit?: string; label: string; delta?: string }[];
    }
  | { kind: 'photo'; intent: PhotoIntent; alt: string }
  /** Oversized serif numeral. The milestone. */
  | { kind: 'bignum'; value: string; caption: string }
  | { kind: 'quote'; text: string; attribution?: string }
  /** Horizontal meters. Every row must be real data — see the note below. */
  | {
      kind: 'bars';
      rows: { label: string; value: string; pct: number; note?: string; icon?: IconName }[];
    }
  | { kind: 'note'; title: string; text: string; link?: string; icon?: IconName }
  /** Three short benefit columns under a photo. Icons are optional throughout. */
  | { kind: 'trio'; items: { icon?: IconName; lines: [string, string] }[] }
  /** Photo with a card overlapping its lower edge. Stacks in Outlook. */
  | { kind: 'photoOverlay'; intent: PhotoIntent; alt: string; lines: string[]; cta: { label: string; url: string } }
  | { kind: 'cta'; label: string; url: string };

/**
 * Icons are hosted PNGs, not SVG and not an icon font.
 *
 * Gmail strips `<svg>` on every platform and no mail client loads an icon
 * webfont reliably, so a raster sprite served from pawtchi.com is the only
 * approach that actually renders. They are 48px square at 2x for a 24px slot.
 *
 * Every icon is decorative — the label beside it always carries the meaning —
 * so they take `alt=""` and vanish silently when images are blocked, which is a
 * large share of first opens. Nothing here may become the only way to read a
 * row. If `iconBase` is not configured they are omitted entirely and the
 * layouts close up.
 */
export type IconName =
  | 'activity'
  | 'nutrition'
  | 'hydration'
  | 'weight'
  | 'sun'
  | 'heart'
  | 'bolt'
  | 'bond';

export interface TemplateInput {
  preheader: string;
  blocks: EmailBlock[];
  /** Resolved absolute URLs, keyed by intent. */
  photos: Record<PhotoIntent, string>;
  unsubscribeUrl: string | null;
  unsubscribeLabel: string;
  /** Small right-aligned label in the header, e.g. "Your weekly update". */
  kicker: string;
  footerNote?: string;
  /**
   * Absolute base for icon PNGs, e.g. `https://pawtchi.com/email/icons`.
   * Omit and every icon slot collapses — the layouts are built to close up
   * rather than leave a hole, so shipping before the assets exist is safe.
   */
  iconBase?: string;
  /**
   * Origin that relative CTA paths are resolved against, e.g.
   * `https://pawtchi.com`.
   *
   * Compositions write `/app/home` because that path is the shared contract
   * with `EMAIL_CAMPAIGN_WEB_PATH` and the universal-link handler. A relative
   * href is meaningless in a mail client — there is no document origin to
   * resolve it against — so it is made absolute exactly once, here, rather than
   * relying on every composition to remember.
   */
  baseUrl?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A full-width table row. Every block is one of these.
 *
 * Carries `.pad` so the media query can pull the 32px side padding in to 20px
 * on a phone — at 375px, 32px each side leaves 311px of content, which is tight
 * for a 30px serif numeral beside a label.
 */
function row(inner: string, pad = '0 32px'): string {
  return `<tr><td class="pad" style="padding:${pad};">${inner}</td></tr>`;
}

/**
 * A 24px decorative icon, or an empty string when icons are not configured.
 *
 * `alt=""` is deliberate and not laziness: every icon here sits beside a label
 * that already says the same thing, so announcing it again would be noise for a
 * screen reader and a duplicated word for anyone with images blocked.
 */
function icon(name: IconName | undefined, input: TemplateInput): string {
  if (!name || !input.iconBase) return '';
  return `<img src="${esc(input.iconBase)}/${esc(name)}.png" width="24" height="24" alt="" style="display:block;width:24px;height:24px;border:0;" />`;
}

/** Resolves a composition's relative path against the configured origin. */
function href(url: string, input: TemplateInput): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) return url;
  const base = (input.baseUrl ?? '').replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ── Block renderers ─────────────────────────────────────────────────────────

function renderBlock(b: EmailBlock, input: TemplateInput): string {
  const C = EMAIL_COLOR;

  switch (b.kind) {
    case 'hero':
      return row(
        `<div class="hero" style="font-family:${SERIF};font-size:38px;line-height:1.12;font-weight:normal;color:${C.ink};letter-spacing:-0.5px;margin:0;">${esc(b.text)}</div>`,
        '26px 32px 0',
      );

    case 'text':
      return row(
        `<div style="font-family:${SANS};font-size:15px;line-height:1.65;color:${C.body};">${esc(b.text)}</div>`,
        '14px 32px 0',
      );

    case 'eyebrow':
      return row(
        `<div style="font-family:${SANS};font-size:10px;line-height:1.4;letter-spacing:1.8px;text-transform:uppercase;color:${C.muted};">${esc(b.text)}</div>`,
        '22px 32px 0',
      );

    // Height is capped because the source is frequently the owner's own upload
    // and can be any aspect ratio. Unconstrained, a portrait photo renders 833px
    // tall at 536px wide and swallows the whole email — the milestone measured
    // 1314px before this cap.
    //
    // `object-fit` is ignored by Outlook, which will show the full height there.
    // That is the acceptable half of the trade: Outlook is a desktop client with
    // room to scroll, and the alternative is cropping someone's photo of their
    // dog server-side, which we should not be doing to an image they chose.
    case 'photo':
      return row(
        `<img src="${esc(input.photos[b.intent])}" width="536" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:536px;height:auto;max-height:340px;object-fit:cover;object-position:center;border:0;border-radius:12px;" />`,
        '20px 32px 0',
      );

    // The weekly-summary signature: image on the left, a hairline-divided stat
    // column on the right. Two <td>s rather than flex, and the stats stack
    // under the photo on narrow screens only in clients that honour the media
    // query — Outlook keeps them side by side, which is fine at 536px.
    case 'photoStats': {
      const stats = b.stats
        .map(
          (s, i) => `
          <tr><td style="padding:${i ? '14px 0 0' : '0'};${i ? `border-top:1px solid ${C.hairline};` : ''}">
            ${i ? '<div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>' : ''}
            <div style="font-family:${SERIF};font-size:30px;line-height:1;color:${C.ink};">${esc(s.value)}${
              s.unit ? `<span style="font-family:${SANS};font-size:14px;color:${C.ink};"> ${esc(s.unit)}</span>` : ''
            }</div>
            <div style="font-family:${SANS};font-size:12px;line-height:1.4;color:${C.muted};padding-top:5px;">${esc(s.label)}</div>
            ${
              s.delta
                ? `<div style="font-family:${SANS};font-size:11px;line-height:1.4;color:${C.amber};padding-top:3px;">${esc(s.delta)}</div>`
                : ''
            }
          </td></tr>`,
        )
        .join('');

      // The columns carry `.col` so the media query in <head> can stack them on
      // a phone. Outlook ignores media queries entirely, which is the right
      // outcome — it is a desktop client and 536px has room for both.
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="col col-photo" width="232" valign="top" style="width:232px;">
              <img src="${esc(input.photos[b.photo.intent])}" width="232" alt="${esc(b.photo.alt)}" style="display:block;width:100%;max-width:232px;height:auto;border:0;border-radius:10px;" />
            </td>
            <td class="gutter" width="24" style="width:24px;">&nbsp;</td>
            <td class="col" valign="top">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${stats}</table>
            </td>
          </tr>
        </table>`,
        '22px 32px 0',
      );
    }

    case 'bignum':
      return row(
        `<div style="text-align:center;">
          <div class="bignum" style="font-family:${SERIF};font-size:96px;line-height:0.92;color:${C.ink};letter-spacing:-2px;">${esc(b.value)}</div>
          <div style="font-family:${SANS};font-size:11px;line-height:1.4;letter-spacing:3.4px;text-transform:uppercase;color:${C.ink};padding-top:12px;">${esc(b.caption)}</div>
        </div>`,
        '28px 32px 0',
      );

    case 'quote':
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sunken};border-radius:10px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-family:${SERIF};font-size:16px;line-height:1.55;color:${C.ink};font-style:italic;">${esc(b.text)}</div>
            ${b.attribution ? `<div style="font-family:${SANS};font-size:11px;color:${C.muted};padding-top:8px;">${esc(b.attribution)}</div>` : ''}
          </td></tr>
        </table>`,
        '20px 32px 0',
      );

    // Meters. There is no decorative row here and there must never be: the
    // retired digest hardcoded `waterIntakeScore: 'Good'` for every owner and
    // shipped it for four months. A row whose number cannot be computed is
    // omitted by the caller, not filled with a plausible word.
    case 'bars': {
      const rows = b.rows
        .map(
          (r, i) => {
            const ico = icon(r.icon, input);
            return `
          <tr><td style="padding:${i ? '16px 0 0' : '0'};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                ${ico ? `<td width="34" valign="top" style="width:34px;padding-top:1px;">${ico}</td>` : ''}
                <td style="font-family:${SANS};font-size:12px;color:${C.muted};">${esc(r.label)}</td>
                ${r.note ? `<td align="right" style="font-family:${SANS};font-size:11px;color:${C.amber};">${esc(r.note)}</td>` : '<td></td>'}
              </tr>
            </table>
            <div style="font-family:${SANS};font-size:14px;font-weight:bold;color:${C.ink};padding:2px 0 7px;${ico ? 'margin-left:34px;' : ''}">${esc(r.value)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.hairline};border-radius:3px;">
              <tr><td style="line-height:5px;font-size:1px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${Math.max(2, Math.min(100, Math.round(r.pct)))}%" style="background:${C.yellow};border-radius:3px;">
                  <tr><td style="line-height:5px;font-size:1px;">&nbsp;</td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>`;
          },
        )
        .join('');

      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sunken};border-radius:10px;">
          <tr><td style="padding:18px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
          </td></tr>
        </table>`,
        '20px 32px 0',
      );
    }

    case 'note': {
      const ico = icon(b.icon, input);
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sunken};border-radius:10px;">
          <tr>
            ${ico ? `<td width="52" valign="top" style="width:52px;padding:17px 0 16px 18px;">${ico}</td>` : ''}
            <td style="padding:16px 18px;">
              <div style="font-family:${SANS};font-size:12px;font-weight:bold;color:${C.ink};">${esc(b.title)}</div>
              <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:${C.body};padding-top:5px;">${esc(b.text)}</div>
              ${b.link ? `<div style="font-family:${SANS};font-size:12px;color:${C.amber};padding-top:8px;">${esc(b.link)}</div>` : ''}
            </td>
          </tr>
        </table>`,
        '16px 32px 0',
      );
    }

    // Three short columns of benefit copy. Deliberately not a list: the point
    // is that they are read at a glance rather than in sequence.
    case 'trio': {
      const cells = b.items
        .map((it) => {
          const ico = icon(it.icon, input);
          return `<td class="col" width="33%" valign="top" align="center" style="padding:0 6px;">
            ${ico ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>${ico}</td></tr></table>` : ''}
            <div style="font-family:${SANS};font-size:12px;font-weight:bold;color:${C.ink};padding-top:${ico ? '9px' : '0'};">${esc(it.lines[0])}</div>
            <div style="font-family:${SANS};font-size:12px;line-height:1.45;color:${C.muted};padding-top:2px;">${esc(it.lines[1])}</div>
          </td>`;
        })
        .join('');
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${cells}</tr></table>`,
        '22px 32px 0',
      );
    }

    // Photo with a card riding its lower edge. The overlap is a negative
    // margin, which Outlook ignores — there the card simply sits below the
    // image, which is a perfectly good layout rather than a broken one. That is
    // the whole test for whether an effect is safe to use in email.
    case 'photoOverlay':
      return row(
        `<img src="${esc(input.photos[b.intent])}" width="536" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px;" />
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="86%" align="center" style="margin:-52px auto 0;background:${C.card};border-radius:12px;border:1px solid ${C.hairline};">
          <tr><td align="center" style="padding:20px 18px;">
            ${b.lines
              .map(
                (l, i) =>
                  `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${i === 0 ? C.ink : C.muted};">${esc(l)}</div>`,
              )
              .join('')}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:14px;">
              <tr><td align="center" style="background:${C.yellow};border-radius:999px;">
                <a href="${esc(href(b.cta.url, input))}" style="display:inline-block;padding:13px 30px;font-family:${SANS};font-size:14px;font-weight:bold;color:${C.ink};text-decoration:none;border-radius:999px;">${esc(b.cta.label)} &nbsp;&rarr;</a>
              </td></tr>
            </table>
          </td></tr>
        </table>`,
        '20px 32px 0',
      );

    // A pill in a table, because border-radius does not exist in Outlook and a
    // rounded div would simply square off. It stays legible either way; the
    // radius is a bonus in clients that have it.
    case 'cta':
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
          <tr><td align="center" style="background:${C.yellow};border-radius:999px;">
            <a href="${esc(href(b.url, input))}" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:14px;font-weight:bold;color:${C.ink};text-decoration:none;border-radius:999px;">${esc(b.label)} &nbsp;&rarr;</a>
          </td></tr>
        </table>`,
        '26px 32px 0',
      );
  }
}

// ── Document ────────────────────────────────────────────────────────────────

/**
 * The plain-text alternative.
 *
 * Not optional and not a courtesy. A multipart message with no text part is a
 * recognised spam signal, and send-email's previous default — "Please view this
 * email in an HTML-compatible client" — is worse than nothing: it is a single
 * boilerplate line every message shares, which is itself a fingerprint.
 *
 * Derived from the same blocks so it can never drift from what the HTML says.
 */
export function renderEmailText(input: TemplateInput): string {
  const lines: string[] = [];

  for (const b of input.blocks) {
    switch (b.kind) {
      case 'hero':
        lines.push(b.text, '');
        break;
      case 'text':
      case 'eyebrow':
        lines.push(b.text, '');
        break;
      case 'photoStats':
        for (const s of b.stats) {
          lines.push(`${s.value}${s.unit ? ' ' + s.unit : ''} — ${s.label}${s.delta ? ` (${s.delta})` : ''}`);
        }
        lines.push('');
        break;
      case 'bignum':
        lines.push(`${b.value} ${b.caption}`, '');
        break;
      case 'quote':
        lines.push(`"${b.text}"${b.attribution ? ` — ${b.attribution}` : ''}`, '');
        break;
      case 'bars':
        for (const r of b.rows) lines.push(`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
        lines.push('');
        break;
      case 'note':
        lines.push(b.title, b.text, '');
        break;
      case 'trio':
        for (const it of b.items) lines.push(`${it.lines[0]} — ${it.lines[1]}`);
        lines.push('');
        break;
      case 'photoOverlay':
        lines.push(...b.lines, '', `${b.cta.label}: ${href(b.cta.url, input)}`, '');
        break;
      case 'cta':
        lines.push(`${b.label}: ${href(b.url, input)}`, '');
        break;
      // A photo has no text equivalent beyond its alt, which describes an image
      // that is not here. Omitted rather than narrated.
      case 'photo':
        break;
    }
  }

  lines.push('—', 'Pawtchi · Hey Living Club Pty Ltd');
  if (input.unsubscribeUrl) {
    lines.push(`Stop ${input.unsubscribeLabel}: ${input.unsubscribeUrl}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderEmailHtml(input: TemplateInput): string {
  const C = EMAIL_COLOR;
  const body = input.blocks.map((b) => renderBlock(b, input)).join('');

  const footer = `
    <tr><td style="padding:30px 32px 30px;">
      <div style="border-top:1px solid ${C.hairline};padding-top:16px;">
        ${
          input.footerNote
            ? `<div style="font-family:${SANS};font-size:11px;line-height:1.6;color:${C.muted};padding-bottom:8px;">${esc(input.footerNote)}</div>`
            : ''
        }
        <div style="font-family:${SANS};font-size:11px;line-height:1.7;color:${C.muted};">
          Pawtchi &nbsp;·&nbsp; Hey Living Club Pty Ltd${
            input.unsubscribeUrl
              ? `<br /><a href="${esc(input.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Stop ${esc(input.unsubscribeLabel)}</a>`
              : ''
          }
        </div>
      </div>
    </td></tr>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Pawtchi</title>
<!--
  The only <style> block in the document, and it carries nothing the email
  depends on. Gmail's support for embedded styles is inconsistent and Outlook
  ignores media queries outright, so everything structural is inlined above and
  this only *improves* narrow screens. If a client drops it, the email still
  reads — it just keeps the photo and stats side by side.

  Most email is opened on a phone, so this is not a nicety.
-->
<!--
  Geist, for the clients that will take it. Wrapped so Outlook never sees it:
  the Word engine chokes on @import and can render the literal text into the
  body. Everyone else falls through to the system stack, which is what the
  design was actually checked in.
-->
<!--[if !mso]><!-->
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&display=swap" rel="stylesheet" type="text/css" />
<!--<![endif]-->
<style type="text/css">
  @media only screen and (max-width:600px) {
    .col { display:block !important; width:100% !important; max-width:100% !important; }
    .col-photo { padding-bottom:18px !important; }
    .col-photo img { max-width:100% !important; }
    .gutter { display:none !important; width:0 !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .hero { font-size:31px !important; }
    .bignum { font-size:74px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.cream};">
  <tr><td align="center" style="padding:24px 12px;">
    <!--
      The card lifts off the cream with a soft shadow. Outlook drops
      box-shadow entirely, so the hairline border is what gives it an edge
      there — without it the card and the page ground are both pale warm
      neutrals and the card boundary disappears completely.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;background:${C.card};border-radius:14px;border:1px solid ${C.hairline};box-shadow:0 1px 2px rgba(26,26,26,0.04),0 8px 24px rgba(26,26,26,0.06);">
      <tr><td style="padding:22px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-family:${SANS};font-size:15px;font-weight:bold;color:${C.ink};">Pawtchi</td>
            <td align="right" style="font-family:${SANS};font-size:11px;color:${C.muted};">${esc(input.kicker)}</td>
          </tr>
        </table>
      </td></tr>
      ${body}
      ${footer}
    </table>
  </td></tr>
</table>
</body></html>`;
}
