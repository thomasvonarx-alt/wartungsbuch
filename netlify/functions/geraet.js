const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const MONATE = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];

function formatMonat(d) {
  return MONATE[d.getMonth()] + ' ' + d.getFullYear();
}
function formatDatum(d) {
  return d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear();
}
function getText(prop) {
  if (!prop) return '';
  if (prop.rich_text) return prop.rich_text[0]?.plain_text || '';
  if (prop.title)     return prop.title[0]?.plain_text || '';
  if (prop.select)    return prop.select?.name || '';
  return '';
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const geraeteId = event.queryStringParameters?.id?.trim();
  if (!geraeteId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geräte-ID fehlt' }) };
  }

  try {
    // Alle Einträge dieser Geräte-ID laden, nach Datum absteigend
    const alleEintraege = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Geräte-ID', title: { equals: geraeteId } },
      sorts: [{ property: 'Letzte Reinigung', direction: 'descending' }]
    });

    if (alleEintraege.results.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Gerät nicht gefunden' }) };
    }

    // Neuester Eintrag als Hauptdatenquelle
    const row = alleEintraege.results[0];
    const p   = row.properties;

    // Letzte Reinigung
    const letzteReinigungRaw = p['Letzte Reinigung']?.date?.start;
    const letzteReinigung    = letzteReinigungRaw ? new Date(letzteReinigungRaw) : new Date();

    // Nächste Fälligkeit direkt aus Notion
    const naechsteFaelligkeitRaw = p['Nächste Fälligkeit']?.date?.start;
    const naechsteReinigung      = naechsteFaelligkeitRaw
      ? new Date(naechsteFaelligkeitRaw)
      : new Date(letzteReinigung.getFullYear() + 3, letzteReinigung.getMonth(), letzteReinigung.getDate());

    // Wartungsintervall aus Text parsen (z.B. "2 Jahre" oder "3")
    const intervallText  = getText(p['Wartungsintervall']);
    const intervallJahre = parseInt(intervallText) || 3;

    // Filterwechsel-Intervall aus Notion
    const filterwechselIntervall = p['Filterwechsel-Intervall (Monate)']?.number || 6;

    const heute           = new Date();
    const diffMs          = naechsteReinigung - heute;
    const tageVerbleibend = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const status          = p['Status']?.select?.name === 'Konform' ? 'konform' : 'bald_faellig';

    // Letzten Filterwechsel-Eintrag finden
    const letzterFilterEintrag = alleEintraege.results.find(r => {
      const notiz = getText(r.properties['Notizen']).toLowerCase();
      const typ   = getText(r.properties['Gerätetyp']).toLowerCase();
      return notiz.includes('filter') || typ.includes('filter');
    });

    // Nächsten Filterwechsel berechnen: letzter Filterwechsel + Intervall
    let naechsterFilterwechsel;
    if (letzterFilterEintrag) {
      const letzterDatumRaw = letzterFilterEintrag.properties['Letzte Reinigung']?.date?.start;
      const letzterDatum    = letzterDatumRaw ? new Date(letzterDatumRaw) : heute;
      naechsterFilterwechsel = new Date(letzterDatum);
      naechsterFilterwechsel.setMonth(naechsterFilterwechsel.getMonth() + filterwechselIntervall);
    } else {
      naechsterFilterwechsel = new Date(heute);
      naechsterFilterwechsel.setMonth(naechsterFilterwechsel.getMonth() + filterwechselIntervall);
    }

    // Servicehistorie aufbereiten
    const berichte = alleEintraege.results.map(r => {
      const rp      = r.properties;
      const dateRaw = rp['Letzte Reinigung']?.date?.start;
      const datum   = dateRaw ? formatDatum(new Date(dateRaw)) : '';
      const files   = rp['Bericht-URL']?.files || [];
      const url     = files[0]?.file?.url || files[0]?.external?.url || null;
      const notizen = getText(rp['Notizen']) || getText(rp['Gerätetyp']) || 'Serviceeinsatz';
      return { datum, beschreibung: notizen, berichtUrl: url };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        geraeteId:                   getText(p['Geräte-ID']),
        name:                        getText(p['Gerätetyp']) || geraeteId,
        standort:                    getText(p['Standort']),
        kundenname:                  getText(p['Kundenname']),
        techniker:                   getText(p['Techniker']),
        intervall:                   intervallJahre,
        filterwechselIntervall,
        naechsteFaelligkeit:         formatMonat(naechsteReinigung),
        naechsterFilterwechsel:      formatMonat(naechsterFilterwechsel),
        naechsterFilterwechselDatum: naechsterFilterwechsel.toISOString(),
        tageVerbleibend,
        status,
        berichte
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Interner Fehler: ' + err.message }) };
  }
};
