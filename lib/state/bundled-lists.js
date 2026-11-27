/* WildFire - catalog of built-in remote filter lists.
 *
 * These entries are WildFire-owned metadata for public filter-list URLs. No
 * filter text, upstream asset file, or code is bundled: every list is fetched
 * directly, stored locally, and applied only while enabled. The catalog mirrors
 * a broad stock list family; WildFire names are user-facing and the default
 * selection is enabled on a fresh install. Explicit user choices survive
 * reseeds. The legacy bundled sentinel and former WildFire starter URL still
 * map to the default entry; filters/default.txt is only an offline fallback.
 */
(function (global) {
  'use strict';

  const DEFAULT_URL = 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt';
  const LEGACY_URL = 'wildfire:bundled/default.txt';
  const STARTER_URL = 'https://raw.githubusercontent.com/itsrody/WildFire/main/filters/default.txt';
  const LEGACY_URLS = Object.freeze([LEGACY_URL, STARTER_URL]);
  const CATALOG = Object.freeze([
    {"id":"wildfire-builtin-core-filters","url":"https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt","name":"WildFire — core — Ads","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-core-badware","url":"https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt","name":"WildFire — core — Badware risks","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-core-privacy","url":"https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt","name":"WildFire — core — Privacy","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-core-unbreak","url":"https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt","name":"WildFire — core — Unbreak","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-core-quick-fixes","url":"https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt","name":"WildFire — core — Quick fixes","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-core-experimental","url":"https://ublockorigin.github.io/uAssetsCDN/filters/experimental.min.txt","name":"WildFire — core — Experimental","description":"Built-in remote list covering core WildFire filtering.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-generic","url":"https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt","name":"WildFire — Ads","description":"Built-in remote list covering advertising.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-mobile","url":"https://filters.adtidy.org/extension/ublock/filters/11.txt","name":"WildFire — Mobile Ads","description":"Built-in remote list covering advertising.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ads","url":"https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easylist.txt","name":"WildFire — public ads","description":"Built-in remote list covering advertising.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-provider-spyware-url","url":"https://ublockorigin.github.io/uAssetsCDN/filters/privacy-removeparam.txt","name":"WildFire — URL Tracking Protection","description":"Built-in remote list covering trackers and privacy.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-block-lan","url":"https://ublockorigin.github.io/uAssetsCDN/filters/lan-block.txt","name":"WildFire — Block Outsider Intrusion into LAN","description":"Built-in remote list covering trackers and privacy.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-privacy","url":"https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easyprivacy.txt","name":"WildFire — privacy","description":"Built-in remote list covering trackers and privacy.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-malware-1","url":"https://curbengh.github.io/malware-filter/urlhaus-filter-vivaldi-online.txt","name":"WildFire — Online Malicious URL Blocklist","description":"Built-in remote list covering malicious URLs.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-curben-phishing","url":"https://curbengh.github.io/phishing-filter/phishing-filter.txt","name":"WildFire — Phishing URL Blocklist","description":"Built-in remote list covering malicious URLs.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-cookies","url":"https://filters.adtidy.org/extension/ublock/filters/18.txt","name":"WildFire — Cookie Notices","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-core-cookies-provider","url":"https://ublockorigin.github.io/uAssetsCDN/filters/annoyances-cookies.txt","name":"WildFire — core — Cookie Notices","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-widgets-cookiemonster","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-cookies.txt","name":"WildFire — Cookie Notices","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-social","url":"https://filters.adtidy.org/extension/ublock/filters/4.txt","name":"WildFire — Social Widgets","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-widgets-social","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-social.txt","name":"WildFire — Social Widgets","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-widgets-thirdparty-social","url":"https://secure.fanboy.co.nz/fanboy-antifacebook.txt","name":"WildFire — Anti-Facebook","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-popup-overlays","url":"https://filters.adtidy.org/extension/ublock/filters/19.txt","name":"WildFire — Popup Overlays","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-mobile-app-banners","url":"https://filters.adtidy.org/extension/ublock/filters/20.txt","name":"WildFire — Mobile App Banners","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-other-annoyances","url":"https://filters.adtidy.org/extension/ublock/filters/21.txt","name":"WildFire — Other Annoyances","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-provider-widgets","url":"https://filters.adtidy.org/extension/ublock/filters/22.txt","name":"WildFire — Widgets","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ads-annoyances","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-annoyances.txt","name":"WildFire — Other Annoyances","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ads-chat","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-chat.txt","name":"WildFire — Chat Widgets","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-widgets-ai-suggestions","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-ai.txt","name":"WildFire — AI Widgets","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ads-newsletters","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-newsletters.txt","name":"WildFire — Newsletter Notices","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ads-notifications","url":"https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-notifications.txt","name":"WildFire — Notifications","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-core-annoyances","url":"https://ublockorigin.github.io/uAssetsCDN/filters/annoyances.min.txt","name":"WildFire — core — Annoyances","description":"Built-in remote list covering page annoyances.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-dpollock-0","url":"https://someonewhocares.org/hosts/hosts","name":"WildFire — hosts file","description":"Built-in remote list covering hosts and multipurpose blocking.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-plowe-0","url":"https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext","name":"WildFire — tracking hosts","description":"Built-in remote list covering hosts and multipurpose blocking.","builtin":true,"defaultOn":true},
    {"id":"wildfire-builtin-alb-0","url":"https://raw.githubusercontent.com/AnXh3L0/blocklist/master/albanian-easylist-addition/Albania.txt","name":"WildFire — al xk: Adblock List for Albania","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ara-0","url":"https://easylist-downloads.adblockplus.org/Liste_AR.txt","name":"WildFire — eg sa ma dz: Liste AR","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-bgr-0","url":"https://stanev.org/abp/adblock_bg.txt","name":"WildFire — bg: Bulgarian Adblock list","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-chn-0","url":"https://filters.adtidy.org/extension/ublock/filters/224.txt","name":"WildFire — cn tw: WildFire Chinese (中文)","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-cze-0","url":"https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt","name":"WildFire — cz sk: WildFire Czech and Slovak","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-deu-0","url":"https://easylist.to/easylistgermany/easylistgermany.txt","name":"WildFire — de ch at: WildFire Germany","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-est-0","url":"https://ubo-et.lepik.io/list.txt","name":"WildFire — ee: Eesti saitidele kohandatud filter","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-fin-0","url":"https://raw.githubusercontent.com/finnish-easylist-addition/finnish-easylist-addition/gh-pages/Finland_adb.txt","name":"WildFire — fi: Adblock List for Finland","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-fra-0","url":"https://filters.adtidy.org/extension/ublock/filters/16.txt","name":"WildFire — fr be ca: WildFire Français","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-grc-0","url":"https://www.void.gr/kargig/void-gr-filters.txt","name":"WildFire — gr cy: Greek AdBlock Filter","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-hrv-0","url":"https://raw.githubusercontent.com/DandelionSprout/adfilt/master/SerboCroatianList.txt","name":"WildFire — hr rs: Dandelion Sprout's Serbo-Croatian filters","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-hun-0","url":"https://cdn.jsdelivr.net/gh/hufilter/hufilter@gh-pages/hufilter-ublock.txt","name":"WildFire — hu: hufilter","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-idn-0","url":"https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt","name":"WildFire — id my: ABPindo","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ind-0","url":"https://easylist-downloads.adblockplus.org/indianlist.txt","name":"WildFire — in lk np: IndianList","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-irn-0","url":"https://cdn.jsdelivr.net/gh/PersianBlocker/PersianBlocker@main/PersianBlocker.txt","name":"WildFire — ir: فارسی (Persian)","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-isl-0","url":"https://raw.githubusercontent.com/brave/adblock-lists/master/custom/is.txt","name":"WildFire — is: Icelandic ABP List","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-isr-0","url":"https://raw.githubusercontent.com/easylist/EasyListHebrew/master/EasyListHebrew.txt","name":"WildFire — il: WildFire Hebrew","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ita-0","url":"https://easylist-downloads.adblockplus.org/easylistitaly.txt","name":"WildFire — it: WildFire Italy","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-jpn-1","url":"https://filters.adtidy.org/extension/ublock/filters/7.txt","name":"WildFire — jp: WildFire Japanese","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-kor-1","url":"https://cdn.jsdelivr.net/npm/@filteringdev/filterslists-ko@latest/dist/filterslist-uBlockOrigin-classic.txt","name":"WildFire — kr: 한국어 (Korean)","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ltu-0","url":"https://cdn.jsdelivr.net/gh/EasyList-Lithuania/easylist_lithuania@master/easylistlithuania.txt","name":"WildFire — lt: WildFire Lithuania","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-lva-0","url":"https://raw.githubusercontent.com/Latvian-List/adblock-latvian/master/lists/latvian-list.txt","name":"WildFire — lv: Latvian List","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-mkd-0","url":"https://raw.githubusercontent.com/DeepSpaceHarbor/Macedonian-adBlock-Filters/master/Filters","name":"WildFire — mk: Macedonian adBlock Filters","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-nld-0","url":"https://filters.adtidy.org/extension/ublock/filters/8.txt","name":"WildFire — nl be: WildFire Dutch","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-nor-0","url":"https://raw.githubusercontent.com/DandelionSprout/adfilt/master/NorwegianList.txt","name":"WildFire — no dk is: Dandelion Sprouts nordiske filtre","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-pol-0","url":"https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt","name":"WildFire — pl: Oficjalne Polskie Filtry do WildFirea Origin","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-pol-3","url":"https://hole.cert.pl/domains/v2/domains_ublock.txt","name":"WildFire — pl: CERT.PL's Warning List","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-rou-1","url":"https://raw.githubusercontent.com/tcptomato/ROad-Block/master/road-block-filters-light.txt","name":"WildFire — ro md: Romanian Ad (ROad) Block List Light","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-rus-0","url":"https://cdn.jsdelivr.net/gh/dimisa-RUAdList/RUAdListCDN@main/lists/ruadlist.ubo.min.txt","name":"WildFire — ru ua uz kz: RU AdList","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-rus-1","url":"https://cdn.jsdelivr.net/gh/easylist/ruadlist@master/cntblock.txt","name":"WildFire — ru ua uz kz: RU AdList: Counters","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-spa-0","url":"https://easylist-downloads.adblockplus.org/easylistspanish.txt","name":"WildFire — es ar mx co: WildFire Spanish","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-spa-1","url":"https://filters.adtidy.org/extension/ublock/filters/9.txt","name":"WildFire — es ar br pt: WildFire Spanish/Portuguese","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-svn-0","url":"https://raw.githubusercontent.com/betterwebleon/slovenian-list/master/filters.txt","name":"WildFire — si: Slovenian List","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-swe-1","url":"https://raw.githubusercontent.com/lassekongo83/Frellwits-filter-lists/swefilter/swefilter.min.txt","name":"WildFire — se: Frellwit's Swedish Filter","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-tha-0","url":"https://raw.githubusercontent.com/easylist-thailand/easylist-thailand/master/subscription/easylist-thailand.txt","name":"WildFire — th: WildFire Thailand","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-tur-0","url":"https://filters.adtidy.org/extension/ublock/filters/13.txt","name":"WildFire — tr: WildFire Turkish","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-ukr-0","url":"https://filters.adtidy.org/extension/ublock/filters/23.txt","name":"WildFire — ua: WildFire Ukrainian","description":"Built-in remote regional list.","builtin":true,"defaultOn":false},
    {"id":"wildfire-builtin-vie-1","url":"https://raw.githubusercontent.com/abpvn/abpvn/master/filter/abpvn_ublock.txt","name":"WildFire — vn: ABPVN List","description":"Built-in remote regional list.","builtin":true,"defaultOn":false}
  ]);

  function isBundledUrl(value) {
    const text = String(value || '').trim();
    return CATALOG.some(entry => entry.url === text) || LEGACY_URLS.includes(text);
  }

  function find(value) {
    const text = String(value || '').trim();
    const entry = CATALOG.find(item => item.url === text || item.id === text);
    return entry ? Object.assign({}, entry) : null;
  }

  global.WildFireBundledLists = Object.freeze({
    DEFAULT_URL,
    LEGACY_URL,
    STARTER_URL,
    LEGACY_URLS,
    all: () => CATALOG.map(entry => Object.assign({}, entry)),
    defaults: () => CATALOG.filter(entry => entry.defaultOn).map(entry => Object.assign({}, entry)),
    find,
    isBundledUrl
  });
})(this);
