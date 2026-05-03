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
      url,
      originalUrl: url,
      message: 'Google Maps URLではありません。'
    };
  }

  const finalUrl = expandUrl_(url);
  const rawTitle = fetchPageTitle_(finalUrl);
  const title = cleanMapTitle_(rawTitle) || 'Google Maps';

  return {
    ok: true,
    title,
    url: finalUrl,
    originalUrl: url,
    message: ''
  };
}

function createMapFlex_(info) {
  const title = info.title || 'Google Maps';
  const mapUrl = info.url || info.originalUrl;

  const liffUrl = APP.LIFF_PAGE_URL
    + '?mapUrl=' + encodeURIComponent(mapUrl)
    + '&title=' + encodeURIComponent(title);

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
        contents: [
          {
            type: 'text',
            text: '📍 地図共有',
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'md',
            wrap: true
          },
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
        ]
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
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
    });

    return typeof res.getFinalUrl === 'function'
      ? res.getFinalUrl()
      : url;

  } catch (error) {
    return url;
  }
}

function fetchPageTitle_(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
    });

    const html = res.getContentText('UTF-8');

    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) return decodeHtml_(og[1]);

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title) return decodeHtml_(title[1]);

    return '';

  } catch (error) {
    return '';
  }
}

function cleanMapTitle_(title) {
  return String(title || '')
    .replace(/\s*-\s*Google\s*マップ\s*$/i, '')
    .replace(/\s*-\s*Google\s*Maps\s*$/i, '')
    .trim();
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