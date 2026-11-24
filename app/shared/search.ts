const cyrillic: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

function normalize(value: string) {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function translit(value: string) {
  let out = '';
  for (const ch of normalize(value)) out += cyrillic[ch] ?? ch;
  return out
    .replace(/shch|sch/g, 'sh')
    .replace(/dzh|dj/g, 'j')
    .replace(/zh/g, 'j')
    .replace(/kh/g, 'h')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/ts/g, 'c')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/q/g, 'k')
    .replace(/c(?=[aouklmnprstvz]|$)/g, 'k')
    .replace(/ya|ja/g, 'ia')
    .replace(/yu|ju/g, 'iu')
    .replace(/yo|jo/g, 'io')
    .replace(/y/g, 'i')
    .replace(/([a-z])\1+/g, '$1');
}

export function matchesQuery(query: string, fields: string[]) {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const raw = fields.map(normalize);
  const latin = fields.map(translit);
  return tokens.every(token => {
    const clean = token.startsWith('@') && token.length > 1 ? token.slice(1) : token;
    const latinToken = translit(clean);
    return raw.some(value => value.includes(token) || value.includes(clean)) ||
      (latinToken.length > 0 && latin.some(value => value.includes(latinToken)));
  });
}
