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
  const page = fetchMapPage_(finalUrl);
  const title = cleanMapTitle_(page.title) || extractTitleFromMapUrl_(finalUrl) || 'Google Maps';
  const address = cleanMapAddress_(page.address);

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
  const mapUrl = info.url || info.originalUrl;

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

function fetchMapPage_(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
    });

    const html = res.getContentText('UTF-8');
    return {
      title: extractMetaContent_(html, 'property', 'og:title') || extractTitleTag_(html),
      address: extractAddressFromHtml_(html)
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
