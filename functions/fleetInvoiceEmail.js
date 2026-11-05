/* The emails a fleet sends its account clients: one invoice, or the total an
   account owes. Plain functions, so they can be tested without sending. */

const escapeHtml = (value) => String(value === null || value === undefined ?
  "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const pounds = (pence) => {
  const value = Math.abs(pence) / 100;
  return `${pence < 0 ? "-" : ""}£${value.toFixed(2)}`;
};

const day = (date) => (date ? date.toLocaleDateString("en-GB", {
  day: "numeric", month: "short", year: "numeric",
  timeZone: "Europe/London"}) : "");

const fromLines = (from) => [from.name, from.address, from.phone,
  from.vatNumber ? `VAT number ${from.vatNumber}` : ""].filter(Boolean);

const page = (title, body) => `<!doctype html><html><body style="margin:0;` +
  `padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;` +
  `color:#0b0f1a"><div style="max-width:640px;margin:auto;background:#fff;` +
  `border-radius:12px;padding:28px">` +
  `<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>` +
  `${body}</div></body></html>`;

const lines = (values) => values.map(escapeHtml).join("<br>");

/**
 * The email for one invoice.
 * @param {Object} invoice Invoice document, with Date issuedAt and dueAt.
 * @return {Object} {subject, html, text}.
 */
function invoiceEmail(invoice) {
  const from = invoice.from || {};
  const to = invoice.billTo || {};
  const rows = invoice.lines.map((l) => `<tr><td style="padding:8px 0;` +
    `border-bottom:1px solid #e5e7eb">${escapeHtml(l.description)}` +
    `${l.quantity !== 1 ? ` × ${l.quantity}` : ""}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #e5e7eb;` +
    `text-align:right;white-space:nowrap">${pounds(l.amountPence)}</td></tr>`)
      .join("");
  const vat = invoice.vatPercent > 0 ?
    `<p style="margin:4px 0;text-align:right;color:#474e5e">Includes VAT at ` +
    `${invoice.vatPercent}%: ${pounds(invoice.vatPence)}</p>` : "";
  const footer = invoice.notes || from.footer ?
    `<p style="white-space:pre-line;color:#474e5e">` +
    `${escapeHtml([invoice.notes, from.footer].filter(Boolean)
        .join("\n\n"))}</p>` : "";
  const html = page(`Invoice ${invoice.number}`,
      `<p style="color:#474e5e">${lines(fromLines(from))}</p>` +
      `<p><strong>To</strong><br>${lines([to.company, to.address,
        to.telephone].filter(Boolean))}</p>` +
      `<p>Date: ${day(invoice.issuedAt)}<br>Due: ${day(invoice.dueAt)}</p>` +
      `<table style="width:100%;border-collapse:collapse">${rows}</table>` +
      `<p style="margin:16px 0 4px;text-align:right;font-size:18px">` +
      `<strong>Total ${pounds(invoice.totalPence)}</strong></p>` +
      `${vat}${footer}`);
  const text = [
    `Invoice ${invoice.number} from ${from.name}`,
    `To: ${to.company || ""}`,
    `Date: ${day(invoice.issuedAt)}. Due: ${day(invoice.dueAt)}.`,
    "",
    ...invoice.lines.map((l) => `${l.description}: ${pounds(l.amountPence)}`),
    "",
    `Total ${pounds(invoice.totalPence)}`,
    ...(invoice.vatPercent > 0 ? [`Includes VAT at ${invoice.vatPercent}%: ` +
      pounds(invoice.vatPence)] : []),
    ...(invoice.notes ? ["", invoice.notes] : []),
    ...(from.footer ? ["", from.footer] : []),
  ].join("\n");
  return {
    subject: `Invoice ${invoice.number} from ${from.name}: ` +
      pounds(invoice.totalPence),
    html, text,
  };
}

/**
 * The email telling an account client how much they owe in total.
 * @param {Object} from Fleet name, address, phone, vatNumber, footer.
 * @param {Object} account Account: company.
 * @param {Object} owed {invoices: [{number, dueAt, totalPence}], jobs: number,
 *     jobsPence: number}.
 * @return {Object} {subject, html, text}.
 */
function balanceEmail(from, account, owed) {
  const invoiced = owed.invoices.reduce((sum, i) => sum + i.totalPence, 0);
  const total = invoiced + owed.jobsPence;
  const rows = owed.invoices.map((i) => `<tr><td style="padding:8px 0;` +
    `border-bottom:1px solid #e5e7eb">Invoice ${escapeHtml(i.number)}, due ` +
    `${day(i.dueAt)}</td><td style="padding:8px 0;border-bottom:1px solid ` +
    `#e5e7eb;text-align:right">${pounds(i.totalPence)}</td></tr>`).join("");
  const jobs = owed.jobs ? `<tr><td style="padding:8px 0">${owed.jobs} ` +
    `${owed.jobs === 1 ? "job" : "jobs"} not yet invoiced</td>` +
    `<td style="padding:8px 0;text-align:right">${pounds(owed.jobsPence)}` +
    `</td></tr>` : "";
  const html = page(`Amount owed to ${from.name}`,
      `<p style="color:#474e5e">${lines(fromLines(from))}</p>` +
      `<p><strong>Account:</strong> ${escapeHtml(account.company)}</p>` +
      `<table style="width:100%;border-collapse:collapse">${rows}${jobs}` +
      `</table><p style="margin:16px 0;text-align:right;font-size:18px">` +
      `<strong>Total owed ${pounds(total)}</strong></p>` +
      (from.footer ? `<p style="white-space:pre-line;color:#474e5e">` +
        `${escapeHtml(from.footer)}</p>` : ""));
  const text = [
    `Amount owed to ${from.name}`, `Account: ${account.company}`, "",
    ...owed.invoices.map((i) => `Invoice ${i.number}, due ${day(i.dueAt)}: ` +
      pounds(i.totalPence)),
    ...(owed.jobs ? [`${owed.jobs} not yet invoiced: ` +
      pounds(owed.jobsPence)] : []),
    "", `Total owed ${pounds(total)}`, from.footer || "",
  ].join("\n");
  return {subject: `Amount owed to ${from.name}: ${pounds(total)}`, html, text};
}

module.exports = {invoiceEmail, balanceEmail, escapeHtml};
