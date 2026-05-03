const LIFF_ID = '2009965829-2KRcrwks';
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyWJvdBist0kksEkE2DTvrFdZCrQEuy608y__R9NOLKExTHGTn4oKPYUR3WYdRjbVXJ7w/exec';

const DEFAULT_BADGES = [
    'おすすめ',
    '近い',
    'コスパ○',
    '行きたい',
    '集合場所',
    '駅近',
    '雰囲気◎',
    '子連れOK'
];

const selectedBadges = [];

const params = new URLSearchParams(location.search);
const initialMapUrl = params.get('mapUrl') || '';
const initialTitle = params.get('title') || '';

const elMapUrl = document.getElementById('mapUrl');
const elTitle = document.getElementById('title');
const elComment = document.getElementById('comment');
const badgeList = document.getElementById('badgeList');
const customBadgeInput = document.getElementById('customBadge');

const sendButton = document.getElementById('sendButton');
const resolveButton = document.getElementById('resolveButton');
const errorBox = document.getElementById('error');
const doneBox = document.getElementById('done');

elMapUrl.value = initialMapUrl;
elTitle.value = initialTitle;

async function main() {
    try {
        renderBadges_();

        await liff.init({ liffId: LIFF_ID });

        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }

        if (initialMapUrl && !initialTitle) {
            await resolveMapInfo();
        }
    } catch (error) {
        showError_(error.message || '初期化に失敗しました。');
    }
}

async function resolveMapInfo() {
    try {
        hideMessage_();

        const url = elMapUrl.value.trim();
        validateMapUrl_(url);

        setResolving_(true);

        const apiUrl = GAS_API_URL
            + '?action=resolveMap'
            + '&url=' + encodeURIComponent(url);

        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data.ok) {
            throw new Error(data.message || '地図情報を取得できませんでした。');
        }

        elMapUrl.value = data.url || url;
        elTitle.value = data.title || 'Google Maps';
    } catch (error) {
        showError_(error.message || '地図情報の取得に失敗しました。');
    } finally {
        setResolving_(false);
    }
}

function openMap() {
    const url = elMapUrl.value.trim();
    validateMapUrl_(url);
    location.href = url;
}

async function shareMap() {
    try {
        hideMessage_();

        const mapUrl = elMapUrl.value.trim();
        const title = elTitle.value.trim() || 'Google Maps';
        const comment = elComment.value.trim();

        validateMapUrl_(mapUrl);
        setSending_(true);

        const result = await liff.shareTargetPicker([
            {
                type: 'flex',
                altText: `📍 ${title}`,
                contents: createShareFlex_(mapUrl, title, comment, selectedBadges)
            }
        ]);

        if (result) {
            doneBox.style.display = 'block';
            setTimeout(() => liff.closeWindow(), 700);
        } else {
            setSending_(false);
        }
    } catch (error) {
        showError_(error.message || '送信に失敗しました。');
        setSending_(false);
    }
}

function renderBadges_() {
    badgeList.innerHTML = '';

    DEFAULT_BADGES.forEach(label => {
        const button = createBadgeButton_(label);
        badgeList.appendChild(button);
    });

    selectedBadges
        .filter(label => !DEFAULT_BADGES.includes(label))
        .forEach(label => {
            const button = createBadgeButton_(label);
            badgeList.appendChild(button);
        });
}

function createBadgeButton_(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = selectedBadges.includes(label)
        ? 'badge active'
        : 'badge';
    button.textContent = label;
    button.onclick = () => toggleBadge_(label);
    return button;
}

function toggleBadge_(label) {
    const index = selectedBadges.indexOf(label);

    if (index >= 0) {
        selectedBadges.splice(index, 1);
    } else {
        if (selectedBadges.length >= 5) {
            showError_('バッジは最大5つまでです。');
            return;
        }

        selectedBadges.push(label);
    }

    hideMessage_();
    renderBadges_();
}

function addCustomBadge() {
    const label = customBadgeInput.value.trim();

    if (!label) return;

    if (label.length > 12) {
        showError_('バッジは12文字以内にしてください。');
        return;
    }

    if (selectedBadges.includes(label)) {
        customBadgeInput.value = '';
        return;
    }

    if (selectedBadges.length >= 5) {
        showError_('バッジは最大5つまでです。');
        return;
    }

    selectedBadges.push(label);
    customBadgeInput.value = '';

    hideMessage_();
    renderBadges_();
}

function createShareFlex_(mapUrl, title, comment, badges) {
    const bodyContents = [
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
        }
    ];

    if (badges && badges.length > 0) {
        bodyContents.push({
            type: 'box',
            layout: 'horizontal',
            spacing: 'xs',
            flex: 0,
            wrap: true,
            contents: badges.slice(0, 5).map(createBadgeBox_)
        });
    }

    if (comment) {
        bodyContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f5f7fa',
            cornerRadius: 'md',
            paddingAll: 'md',
            contents: [
                {
                    type: 'text',
                    text: 'コメント',
                    size: 'xs',
                    color: '#888888',
                    weight: 'bold'
                },
                {
                    type: 'text',
                    text: comment,
                    size: 'sm',
                    color: '#333333',
                    wrap: true,
                    margin: 'xs'
                }
            ]
        });
    }

    return {
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
                }
            ]
        }
    };
}

function createBadgeBox_(label) {
    return {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#e9fff1',
        cornerRadius: 'xxl',
        paddingAll: 'sm',
        contents: [
            {
                type: 'text',
                text: label,
                size: 'xs',
                color: '#05883a',
                weight: 'bold',
                flex: 0
            }
        ]
    };
}

function validateMapUrl_(url) {
    if (!url) {
        throw new Error('Google Maps URLを入力してください。');
    }

    const isMapUrl =
        url.includes('google.com/maps') ||
        url.includes('maps.app.goo.gl') ||
        url.includes('goo.gl/maps');

    if (!/^https?:\/\//.test(url) || !isMapUrl) {
        throw new Error('Google MapsのURLを入力してください。');
    }
}

function setResolving_(isResolving) {
    resolveButton.disabled = isResolving;
    resolveButton.textContent = isResolving ? '取得中...' : '地図情報を再取得';
}

function setSending_(isSending) {
    sendButton.disabled = isSending;
    sendButton.textContent = isSending ? '送信中...' : '別トークへ送信';
}

function showError_(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
    doneBox.style.display = 'none';
}

function hideMessage_() {
    errorBox.style.display = 'none';
    doneBox.style.display = 'none';
}

main();