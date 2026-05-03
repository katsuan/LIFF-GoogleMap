const PROPS = PropertiesService.getScriptProperties();

const LINE = {
  TOKEN: PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
  REPLY_URL: 'https://api.line.me/v2/bot/message/reply',
};

const APP = {
  LIFF_PAGE_URL: 'https://liff.line.me/2009965829-2KRcrwks',
};

/**
 * LINE Webhook
 */
function doPost(e) {
  const json = JSON.parse(e.postData.contents);
  const event = json.events && json.events[0];

  if (!event || event.type !== 'message' || event.message.type !== 'text') {
    return ok_();
  }

  const text = event.message.text.trim();

  if (!isGoogleMapsUrl_(text)) {
    reply_(event.replyToken, [{
      type: 'text',
      text: 'Google Mapsのリンクを送ってください。'
    }]);
    return ok_();
  }

  const info = resolveMapInfo_(text);
  reply_(event.replyToken, [createMapFlex_(info)]);

  return ok_();
}

/**
 * LIFFから地図情報再取得
 */
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'resolveMap') {
    const url = e.parameter.url || '';
    const result = resolveMapInfo_(url);

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ok_();
}

function resolveMapInfo_(url) {
  if (!isGoogleMapsUrl_(url)) {
    return {
      ok: false,
      title: '',
      address: '',
      url,
      originalUrl: url,
      message: 'Google Maps URLではありません。'
    };
  }

  const finalUrl = expandUrl_(url);
  const page = fetchMapPage_(url, finalUrl);
  const urlInfo = extractMapInfoFromUrl_(finalUrl);
  const rawTitle = normalizeMapTitle_(page.title) || urlInfo.title || extractTitleFromMapUrl_(finalUrl) || 'Google Maps';
  const rawAddress = cleanMapAddress_(page.address) || urlInfo.address;
  const normalized = normalizeMapInfoWithGeocoder_(rawTitle, rawAddress);
  const title = normalized.title || rawTitle || 'Google Maps';
  const address = normalized.address || rawAddress;

  return {
    ok: true,
    title,
    address,
    url: finalUrl,
    originalUrl: url,
    message: ''
  };
}

function createMapFlex_(info) {
  const title = info.title || 'Google Maps';
  const address = info.address || '';
  const mapUrl = info.originalUrl || info.url;

  const liffUrl = APP.LIFF_PAGE_URL
    + '?mapUrl=' + encodeURIComponent(mapUrl)
    + '&title=' + encodeURIComponent(title)
    + '&address=' + encodeURIComponent(address);

  const bodyContents = [
    {
      type: 'text',
      text: `📍 ${title}`,
      weight: 'bold',
      size: 'lg',
      wrap: true
    }
  ];

  if (address) {
    bodyContents.push({
      type: 'text',
      text: address,
      size: 'sm',
      color: '#7C8EA1',
      wrap: true
    });
  }

  bodyContents.push(
    {
      type: 'text',
      text: 'コメントを付けて、別のトークへ共有できます。',
      size: 'sm',
      color: '#666666',
      wrap: true
    },
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#F5F7FA',
      cornerRadius: 'md',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: mapUrl,
          size: 'xs',
          color: '#555555',
          wrap: true
        }
      ]
    }
  );

  return {
    type: 'flex',
    altText: `📍 ${title}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '地図を開く',
              uri: mapUrl
            }
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: 'コメントを付けて共有',
              uri: liffUrl
            }
          }
        ]
      }
    }
  };
}

function isGoogleMapsUrl_(text) {
  return /^https?:\/\/.+/.test(text) &&
    (
      text.includes('google.com/maps') ||
      text.includes('maps.app.goo.gl') ||
      text.includes('goo.gl/maps')
    );
}

function expandUrl_(url) {
  let currentUrl = url;

  for (let i = 0; i < 5; i += 1) {
    try {
      const res = UrlFetchApp.fetch(currentUrl, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
      });

      const code = res.getResponseCode();
      if (code < 300 || code >= 400) {
        return currentUrl;
      }

      const headers = res.getHeaders();
      const location = headers.Location || headers.location;
      if (!location) {
        return currentUrl;
      }

      currentUrl = toAbsoluteUrl_(currentUrl, location);
    } catch (error) {
      return currentUrl;
    }
  }

  return currentUrl;
}

function fetchMapPage_(originalUrl, finalUrl) {
  try {
    const lookupUrls = buildMapLookupUrls_(originalUrl, finalUrl);

    for (let i = 0; i < lookupUrls.length; i += 1) {
      const html = fetchHtml_(lookupUrls[i]);
      if (!html) continue;

      const title = extractTitleFromHtml_(html);
      const address = extractAddressFromHtml_(html);

      if (title || address) {
        return { title: title, address: address };
      }
    }

    return {
      title: '',
      address: ''
    };

  } catch (error) {
    return {
      title: '',
      address: ''
    };
  }
}

function cleanMapTitle_(title) {
  return String(title || '')
    .replace(/\s*-\s*Google\s*マップ\s*$/i, '')
    .replace(/\s*-\s*Google\s*Maps\s*$/i, '')
    .trim();
}

function normalizeMapTitle_(title) {
  const cleaned = cleanMapTitle_(title);
  if (!cleaned) return '';

  const normalized = cleaned.toLowerCase();
  if (normalized === 'google maps' || normalized === 'google map') {
    return '';
  }

  if (cleaned === 'Google マップ') {
    return '';
  }

  return cleaned;
}

function normalizeMapInfoWithGeocoder_(title, address) {
  const geocodeQueries = buildGeocodeQueries_(title, address);
  if (geocodeQueries.length === 0) {
    return { title: '', address: '' };
  }

  try {
    const geocoder = Maps.newGeocoder()
      .setLanguage('ja')
      .setRegion('jp');

    for (let i = 0; i < geocodeQueries.length; i += 1) {
      const response = geocoder.geocode(geocodeQueries[i]);
      const results = (response && response.results) || [];
      if (results.length === 0) continue;

      const result = results[0];
      const geocodedTitle = normalizeMapTitle_(extractGeocoderTitle_(result));
      const geocodedAddress = cleanMapAddress_(result.formatted_address);

      return {
        title: shouldUseGeocodedTitle_(title, geocodedTitle) ? geocodedTitle : '',
        address: shouldUseGeocodedAddress_(address, geocodedAddress) ? geocodedAddress : ''
      };
    }
  } catch (error) {
  }

  return { title: '', address: '' };
}

function buildGeocodeQueries_(title, address) {
  const values = [];
  const safeTitle = String(title || '').trim();
  const safeAddress = String(address || '').trim();

  if (safeTitle && safeAddress) {
    values.push(safeTitle + ' ' + safeAddress);
  }

  if (safeAddress) {
    values.push(safeAddress);
  }

  if (safeTitle) {
    values.push(safeTitle);
  }

  return dedupeStrings_(values);
}

function extractGeocoderTitle_(result) {
  if (!result) return '';

  const components = result.address_components || [];
  const preferredTypes = ['point_of_interest', 'establishment', 'premise', 'subpremise'];

  for (let i = 0; i < preferredTypes.length; i += 1) {
    for (let j = 0; j < components.length; j += 1) {
      const types = components[j].types || [];
      if (types.indexOf(preferredTypes[i]) >= 0) {
        return components[j].long_name || '';
      }
    }
  }

  return '';
}

function shouldUseGeocodedTitle_(currentTitle, geocodedTitle) {
  if (!geocodedTitle) return false;
  if (!currentTitle) return true;
  if (!hasJapaneseText_(currentTitle) && hasJapaneseText_(geocodedTitle)) return true;
  return false;
}

function shouldUseGeocodedAddress_(currentAddress, geocodedAddress) {
  if (!geocodedAddress) return false;
  if (!currentAddress) return true;
  if (!hasJapaneseText_(currentAddress) && hasJapaneseText_(geocodedAddress)) return true;
  return false;
}

function hasJapaneseText_(text) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(text || ''));
}

function cleanMapAddress_(address) {
  const text = decodeHtml_(String(address || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  const segments = text
    .split(/\s*[|・·]\s*/)
    .map(function(part) { return part.trim(); })
    .filter(Boolean);

  for (let i = 0; i < segments.length; i += 1) {
    if (looksLikeAddress_(segments[i])) {
      return segments[i];
    }
  }

  return looksLikeAddress_(text) ? text : '';
}

function looksLikeAddress_(text) {
  return /〒\s*\d{3}-?\d{4}/.test(text) ||
    /(東京都|北海道|(?:京都|大阪)府|.{2,3}県).+/.test(text) ||
    /(市|区|町|村|丁目|番地|号)/.test(text) ||
    /\d+\s+[^,]+,\s*[^,]+/.test(text);
}

function extractTitleFromMapUrl_(url) {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/\/maps\/place\/([^/]+)/);
    return match ? match[1].replace(/\+/g, ' ').trim() : '';
  } catch (error) {
    return '';
  }
}

function extractMapInfoFromUrl_(url) {
  try {
    const decoded = decodeURIComponent(url);
    const qMatch = decoded.match(/[?&]q=([^&]+)/);
    if (!qMatch) {
      return { title: '', address: '' };
    }

    const qValue = qMatch[1].replace(/\+/g, ' ').trim();
    if (!qValue) {
      return { title: '', address: '' };
    }

    const parts = qValue
      .split(/\s*,\s*/)
      .map(function(part) { return part.trim(); })
      .filter(Boolean);

    if (parts.length === 0) {
      return { title: '', address: '' };
    }

    return {
      title: parts[0],
      address: cleanMapAddress_(parts.slice(1).join(', '))
    };
  } catch (error) {
    return { title: '', address: '' };
  }
}

function localizeMapUrl_(url) {
  try {
    if (!/^https?:\/\//i.test(url)) {
      return url;
    }

    if (/[?&](hl|gl|lr)=/i.test(url)) {
      return url;
    }

    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'hl=ja';
  } catch (error) {
    return url;
  }
}

function buildMapLookupUrls_(originalUrl, finalUrl) {
  const urls = [];
  const ftid = extractQueryParam_(finalUrl, 'ftid');
  const cid = extractQueryParam_(finalUrl, 'cid');

  urls.push(localizeMapUrl_(originalUrl));

  if (ftid) {
    urls.push('https://www.google.com/maps?ftid=' + encodeURIComponent(ftid) + '&hl=ja');
  }

  if (cid) {
    urls.push('https://www.google.com/maps?cid=' + encodeURIComponent(cid) + '&hl=ja');
  }

  urls.push(localizeMapUrl_(finalUrl));

  return dedupeStrings_(urls.filter(Boolean));
}

function fetchHtml_(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.6'
      }
    });

    return res.getContentText('UTF-8');
  } catch (error) {
    return '';
  }
}

function extractQueryParam_(url, name) {
  try {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = decodeURIComponent(url).match(new RegExp('[?&]' + escapedName + '=([^&]+)'));
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

function dedupeStrings_(values) {
  const seen = {};
  const result = [];

  values.forEach(function(value) {
    if (!value || seen[value]) return;
    seen[value] = true;
    result.push(value);
  });

  return result;
}

function extractTitleFromHtml_(html) {
  const candidates = [
    extractMetaContent_(html, 'property', 'og:title'),
    extractMetaContent_(html, 'name', 'title'),
    extractMetaContent_(html, 'itemprop', 'name'),
    extractTitleFromJsonLd_(html),
    extractTitleTag_(html)
  ].filter(Boolean);

  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeMapTitle_(candidates[i]);
    if (normalized) return normalized;
  }

  return '';
}

function extractMetaContent_(html, attrName, attrValue) {
  const escapedValue = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '<meta[^>]+'
    + attrName
    + '=["\']'
    + escapedValue
    + '["\'][^>]+content=["\']([^"\']+)["\']',
    'i'
  );
  const match = html.match(pattern);
  return match ? decodeHtml_(match[1]) : '';
}

function extractTitleTag_(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeHtml_(title[1]) : '';
}

function extractAddressFromHtml_(html) {
  const candidates = [
    extractMetaContent_(html, 'property', 'og:description'),
    extractMetaContent_(html, 'name', 'description')
  ].filter(Boolean);

  const ldJsonMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/ig) || [];

  ldJsonMatches.forEach(function(scriptTag) {
    const match = scriptTag.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return;

    try {
      const parsed = JSON.parse(match[1]);
      const address = extractAddressFromJsonLd_(parsed);
      if (address) candidates.push(address);
    } catch (error) {
    }
  });

  const regexCandidates = [
    /"address"\s*:\s*"([^"]+)"/i,
    /"streetAddress"\s*:\s*"([^"]+)"/i
  ];

  regexCandidates.forEach(function(pattern) {
    const match = html.match(pattern);
    if (match) candidates.push(match[1]);
  });

  for (let i = 0; i < candidates.length; i += 1) {
    const cleaned = cleanMapAddress_(candidates[i]);
    if (cleaned) return cleaned;
  }

  return '';
}

function extractTitleFromJsonLd_(html) {
  const ldJsonMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/ig) || [];

  for (let i = 0; i < ldJsonMatches.length; i += 1) {
    const match = ldJsonMatches[i].match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) continue;

    try {
      const parsed = JSON.parse(match[1]);
      const name = extractNameFromJsonLd_(parsed);
      if (name) return name;
    } catch (error) {
    }
  }

  return '';
}

function extractAddressFromJsonLd_(value) {
  if (!value) return '';

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = extractAddressFromJsonLd_(value[i]);
      if (nested) return nested;
    }
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    if (value.address) {
      if (typeof value.address === 'string') return value.address;

      const parts = [
        value.address.postalCode,
        value.address.addressRegion,
        value.address.addressLocality,
        value.address.streetAddress
      ].filter(Boolean);

      if (parts.length > 0) return parts.join(' ');
    }

    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const nested = extractAddressFromJsonLd_(value[keys[i]]);
      if (nested) return nested;
    }
  }

  return '';
}

function extractNameFromJsonLd_(value) {
  if (!value) return '';

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = extractNameFromJsonLd_(value[i]);
      if (nested) return nested;
    }
    return '';
  }

  if (typeof value === 'object') {
    if (typeof value.name === 'string') {
      return value.name;
    }

    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const nested = extractNameFromJsonLd_(value[keys[i]]);
      if (nested) return nested;
    }
  }

  return '';
}

function toAbsoluteUrl_(baseUrl, nextUrl) {
  if (/^https?:\/\//i.test(nextUrl)) {
    return nextUrl;
  }

  if (nextUrl.indexOf('//') === 0) {
    const baseScheme = baseUrl.match(/^(https?):/i);
    return (baseScheme ? baseScheme[1] : 'https') + ':' + nextUrl;
  }

  const baseMatch = baseUrl.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!baseMatch) {
    return nextUrl;
  }

  if (nextUrl.charAt(0) === '/') {
    return baseMatch[1] + nextUrl;
  }

  const basePath = (baseMatch[2] || '/').replace(/\/[^/]*$/, '/');
  return baseMatch[1] + basePath + nextUrl;
}

function decodeHtml_(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function reply_(replyToken, messages) {
  const payload = { replyToken, messages };

  const res = UrlFetchApp.fetch(LINE.REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + LINE.TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('LINE reply failed: ' + code + ' ' + res.getContentText());
  }
}

function ok_() {
  return ContentService
    .createTextOutput('OK')
    .setMimeType(ContentService.MimeType.TEXT);
}
