const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Nur POST erlaubt' }) };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiges JSON' }) };
  }

  const { geraeteId, geraeteName, standort, kundenname, techniker, filterwechselIntervall } = body;
  if (!geraeteId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geräte-ID fehlt' }) };

  const heute = new Date().toISOString().split('T')[0];
  const naechsterWechsel = new Date();
  naechsterWechsel.setMonth(naechsterWechsel.getMonth() + (filterwechselIntervall || 6));

  try {
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Geräte-ID':   { title: [{ text: { content: geraeteId } }] },
        'Gerätetyp':   { rich_text: [{ text: { content: geraeteName || '' } }] },
        'Notizen':     { rich_text: [{ text: { content: 'Filterwechsel durch Kunde erfasst' } }] },
        'Standort':    { rich_text: [{ text: { content: standort || '' } }] },
        'Kundenname':  { rich_text: [{ text: { content: kundenname || '' } }] },
        'Techniker':   { rich_text: [{ text: { content: techniker || 'Kunde' } }] },
        'Letzte Reinigung': { date: { start: heute } },
        'Nächste Fälligkeit': { date: { start: naechsterWechsel.toISOString().split('T')[0] } },
        'Status':      { select: { name: 'Konform' } },
        'Filterwechsel-Intervall (Monate)': { number: filterwechselIntervall || 6 }
      }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Speichern: ' + err.message }) };
  }
};
