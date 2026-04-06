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
function istLueftungsreinigung(r) {
  const notiz = getText(r.properties['Notizen']).toLowerCase();
  return notiz.includes('lüftungsreinigung') || notiz.includes('lueftungsreinigung') || notiz.includes('lüftungs');
}
function istFilterwechsel(r) {
  const notiz = getText(r.properties['Notizen']).toLowerCase();
  const typ   = getText(r.properties['Gerätetyp']).toLowerCase();
  return notiz.includes('filter') || typ.includes('filter');
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
    const alleEintraege = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Geräte-ID', title: { equals: geraeteId } },
      sorts: [{ property: 'Letzte Reinigung', direction: 'descending' }]
    });

    if (alleEintraege.results.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Gerät nicht gefunden' }) };
    }

    // Gerätestammdaten aus dem neuesten Eintrag
    const stamm = alleEintraege.results[0];
    const p     = stamm.properties;

    const heute = new Date();

    // --- LÜFTUNGSREINIGUNG ---
    // Letzten Lüftungsreinigungseintrag suchen
    const letzteReinigung = alleEintraege.results.find(r => istLueftungsreinigung(r));

    let naechsteReinigung;
    let intervallJahre = 2; // Fallback

    if (letzteReinigung) {
      const intervallText = getText(letzteReinigung.properties['Wartungsintervall']);
      intervallJahre = parseInt(intervallText) || 2;
      const letztesDatum = new Date(letzteReinigung.properties['Letzte Reinigung']?.date?.start);
      naechsteReinigung = new Date(letztesDatum);
      naechsteReinigung.setFullYear(naechsteReinigung.getFullYear() + intervallJahre);
    } else {
      // Fallback: direkt aus Notion-Feld Nächste Fälligkeit
      const raw = p['Nächste Fälligkeit']?.date?.start;
      naechsteReinigung = raw ? new Date(raw) : new Date(heute.getFullYear() + 2, heute.getMonth(), heute.getDate());
      const intervallText = getText(p['Wartungsintervall']);
      intervallJahre = parseInt(intervallText) || 2;
    }

    const tageVerbleibend = Math.floor((naechsteReinigung - heute) / (1000 * 60 * 60 * 24));

    // Status für Reinigung: blau = konform, orange = bald fällig (<60 Tage), rot = überfällig
    let reinigungsStatus;
    if (tageVerbleibend < 0)         reinigungsStatus = 'ueberfaellig';
    else if (tageVerbleibend <= 60)  reinigungsStatus = 'bald_faellig';
    else                             reinigungsStatus = 'konform';

    // --- FILTERWECHSEL ---
    const filterwechselIntervall = p['Filterwechsel-Intervall (Monate)']?.number || 6;
    const letzterFilter = alleEintraege.results.find(r => istFilterwechsel(r));

    let naechsterFilterwechsel;
    if (letzterFilter) {
      const letztesDatum = new Date(letzterFilter.properties['Letzte Reinigung']?.date?.start);
      naechsterFilterwechsel = new Date(letztesDatum);
      naechsterFilterwechsel.setMonth(naechsterFilterwechsel.getMonth() + filterwechselIntervall);
    } else {
      naechsterFilterwechsel = new Date(heute);
      naechsterFilterwechsel.setMonth(naechsterFilterwechsel.getMonth() + filterwechselIntervall);
    }

    // --- SERVICEHISTORIE ---
    const berichte = alleEintraege.results.map(r => {
      const rp      = r.properties;
      const dateRaw = rp['Letzte Reinigung']?.date?.start;
      const datum   = dateRaw ? formatDatum(new Date(dateRaw)) : '';
      const files   = rp['Bericht-URL']?.files || [];
      const url     = files[0]?.file?.url || files[0]?.external?.url || null;
      const notizen = getText(rp['Notizen']) || 'Serviceeinsatz';
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
        naechsteFaelligkeitDatum:    naechsteReinigung.toISOString(),
        naechsterFilterwechsel:      formatMonat(naechsterFilterwechsel),
        naechsterFilterwechselDatum: naechsterFilterwechsel.toISOString(),
        tageVerbleibend,
        status:                      reinigungsStatus,
        berichte
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Interner Fehler: ' + err.message }) };
  }
};
