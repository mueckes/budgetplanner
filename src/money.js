// Nur eindeutig lesbare Preisangaben übernehmen; Fremdwährungen nicht als Euro ausgeben.
function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/\s*(€|EUR)\s*$/i, '').trim();
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d+([.,]\d{1,2})?$/.test(text)) text = text.replace(',', '.');
  else return null;
  const number = Number(text);
  return Number.isFinite(number) && number <= 1e9 ? number : null;
}
module.exports = { parsePrice };

