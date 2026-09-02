// ==UserScript==
// @name         osu!GD
// @namespace sayama-kaede
// @author       Sayama Kaede
// @version      0.0.7
// @description  プロフィールに、そのユーザーの Pending・Graveyard のゲスト難易度の譜面を表示します
// @match        https://osu.ppy.sh/users/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/SayamaKaede/osu-gd
// @updateURL    https://raw.githubusercontent.com/SayamaKaede/osu-gd/main/osu-gd.user.js
// @downloadURL  https://raw.githubusercontent.com/SayamaKaede/osu-gd/main/osu-gd.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__lkGuestBeatmaps) return;
    window.__lkGuestBeatmaps = true;

    const PREFIX = 'lk-gd';

    const INITIAL = 6;

    const PER_EXPANSION = 50;

    const SANITY_TOTAL = 5000;

    const DOTS_LIMIT = 12;

    const JAPANESE = (document.documentElement.lang || '').startsWith('ja');

    const SECTIONS = [
        {
            id: 'pending',
            title: JAPANESE ? 'ゲスト難易度のPendingビートマップ' : 'Pending Guest Participation Beatmaps',
            states: ['pending', 'wip'],
        },
        {
            id: 'graveyard',
            title: JAPANESE ? 'ゲスト難易度のGraveyardビートマップ' : 'Graveyarded Guest Participation Beatmaps',
            states: ['graveyard'],
        },
    ];

    const SIGNED_OUT_NOTICE = JAPANESE ? 'osu!にログインすると表示されます' : 'Sign in to osu! to see these';
    const SHOW_MORE = JAPANESE ? 'もっと見る' : 'show more';
    const LOADING = JAPANESE ? '読み込み中…' : 'loading…';

    const STATUS_LABEL = { pending: 'Pending', wip: 'WIP', graveyard: 'Graveyard' };

    const BADGE_LABEL = {
        nsfw: JAPANESE ? '過激表現を含む' : 'Explicit',
        spotlight: JAPANESE ? 'スポットライト' : 'Spotlight',
        featured_artist: JAPANESE ? '注目アーティスト' : 'Featured Artist',
    };

    const MODES = ['osu', 'taiko', 'fruits', 'mania'];

    let profileId = null;
    let sections = null;

    async function search(state, cursor) {
        const params = new URLSearchParams({
            q: `creator=${profileId}`,
            s: state,
            sort: 'updated_desc',
            nsfw: 'true',
        });

        if (cursor) params.set('cursor_string', cursor);

        const response = await fetch(`/beatmapsets/search?${params}`, {
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
        });

        if (!response.ok) throw new Error(`search answered ${response.status}`);

        return response.json();
    }

    function honoured(json) {
        return json?.search?.sort === 'updated_desc' && (json.total ?? 0) < SANITY_TOTAL;
    }

    function keep(sets, states) {
        return (sets ?? []).filter((set) =>
            set.user_id !== profileId
            && states.includes(set.status));
    }

    async function readMore(section) {
        const unfinished = section.streams.filter((s) => !s.done);
        if (unfinished.length === 0) return;

        const answers = await Promise.all(unfinished.map(async (stream) => {
            try {
                const json = await search(stream.state, stream.cursor);

                if (!honoured(json)) return { stream, refused: true };

                stream.cursor = json.cursor_string ?? null;
                stream.done = !stream.cursor;

                return { stream, sets: keep(json.beatmapsets, section.states) };
            } catch (error) {
                console.warn('[ゲスト難易度]', stream.state, error);
                stream.done = true;
                return { stream, sets: [] };
            }
        }));

        if (answers.some((a) => a.refused)) {
            section.refused = true;
            section.streams.forEach((s) => { s.done = true; });
            return;
        }

        for (const answer of answers) section.sets.push(...answer.sets);

        const seen = new Set();
        section.sets = section.sets
            .filter((set) => !seen.has(set.id) && seen.add(set.id))
            .sort((a, b) => Date.parse(b.last_updated ?? 0) - Date.parse(a.last_updated ?? 0));
    }

    const DIFFICULTY_STOPS = [
        [0.1, '#4290FB'], [1.25, '#4FC0FF'], [2, '#4FFFD5'], [2.5, '#7CFF4F'], [3.3, '#F6F05C'],
        [4.2, '#FF8068'], [4.9, '#FF4E6F'], [5.8, '#C645B8'], [6.7, '#6563DE'], [7.7, '#18158E'], [9, '#000000'],
    ];

    const GAMMA = 2.2;

    function channels(hex) {
        return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }

    function difficultyColour(rating) {
        if (!(rating >= 0.1)) return '#AAAAAA';
        if (rating >= 9) return '#000000';

        let index = 0;
        while (index < DIFFICULTY_STOPS.length - 2 && rating > DIFFICULTY_STOPS[index + 1][0]) index++;

        const [low, from] = DIFFICULTY_STOPS[index];
        const [high, to] = DIFFICULTY_STOPS[index + 1];
        const t = (rating - low) / (high - low);

        const mixed = channels(from).map((a, i) => {
            const b = channels(to)[i];
            const value = Math.pow(Math.pow(a, GAMMA) + t * (Math.pow(b, GAMMA) - Math.pow(a, GAMMA)), 1 / GAMMA);
            return Math.max(0, Math.min(255, Math.round(value)));
        });

        return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function statsItem(kind, icon, text) {
        const item = element('div', `beatmapset-panel__stats-item beatmapset-panel__stats-item--${kind}`);
        const wrap = element('span', 'beatmapset-panel__stats-item-icon');
        wrap.append(element('i', `fa-fw ${icon}`));
        item.append(wrap, element('span', null, text));
        return item;
    }

    function dots(set) {
        const holder = element('div', 'beatmapset-panel__extra-item beatmapset-panel__extra-item--dots');

        for (const mode of MODES) {
            const inMode = (set.beatmaps ?? []).filter((b) => b.mode === mode)
                .sort((a, b) => (a.difficulty_rating ?? 0) - (b.difficulty_rating ?? 0));

            if (inMode.length === 0) continue;

            const icon = element('div', 'beatmapset-panel__beatmap-icon');
            icon.append(element('i', `fal fa-extra-mode-${mode}`));
            holder.append(icon);

            if (inMode.length > DOTS_LIMIT) {
                holder.append(element('div', 'beatmapset-panel__beatmap-count', String(inMode.length)));
                continue;
            }

            for (const beatmap of inMode) {
                const dot = element('div', 'beatmapset-panel__beatmap-dot');
                dot.style.setProperty('--bg', difficultyColour(beatmap.difficulty_rating ?? 0));
                holder.append(dot);
            }
        }

        return holder;
    }

    function readableOn(hex) {
        const linear = channels(hex).map((c) => {
            const v = c / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });

        const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];

        return luminance < 0.18 ? '#ffffff' : '#000000';
    }

    let popup = null;
    let popupPanel = null;

    function portal() {
        return document.querySelector('.js-portal') ?? document.body;
    }

    function cardSize() {
        const MARK = 'beatmapset-panel--size-';

        for (const panel of document.querySelectorAll(`.beatmapset-panel:not(.${PREFIX}__panel)`)) {
            const found = [...panel.classList].find((name) => name.startsWith(MARK));
            if (found) return found.slice(MARK.length);
        }

        return 'extra';
    }

    function popupItem(beatmap) {
        const item = element('a', 'beatmaps-popup-item');
        item.href = `/beatmaps/${beatmap.id}`;

        const row = element('div', 'beatmap-list-item');

        const iconCol = element('div', 'beatmap-list-item__col beatmap-list-item__col--icon');
        iconCol.append(element('span', `fal fa-extra-mode-${beatmap.mode}`));

        const badgeCol = element('div', 'beatmap-list-item__col');
        const badge = element('div', 'difficulty-badge');
        const colour = difficultyColour(beatmap.difficulty_rating ?? 0);
        badge.style.setProperty('--bg', colour);
        badge.style.color = readableOn(colour);

        const star = element('span', 'difficulty-badge__icon');
        star.append(element('span', 'fas fa-star'));
        badge.append(star, element('span', 'difficulty-badge__rating', (beatmap.difficulty_rating ?? 0).toFixed(2)));
        badgeCol.append(badge);

        const mainCol = element('div', 'beatmap-list-item__col beatmap-list-item__col--main');
        const version = element('div', 'beatmap-list-item__version u-ellipsis-overflow', `${beatmap.version ?? ''} `);
        version.append(element('span', 'beatmap-list-item__mapper'));
        mainCol.append(version);

        row.append(iconCol, badgeCol, mainCol);
        item.append(row);

        return item;
    }

    function buildPopup(set) {
        const node = element('div', `beatmaps-popup beatmaps-popup--size-${cardSize()} ${PREFIX}__popup`);
        const content = element('div', 'beatmaps-popup__content');

        for (const mode of MODES) {
            const inMode = (set.beatmaps ?? []).filter((b) => b.mode === mode)
                .sort((a, b) => (a.difficulty_rating ?? 0) - (b.difficulty_rating ?? 0));

            if (inMode.length === 0) continue;

            const group = element('div', 'beatmaps-popup__group');
            for (const beatmap of inMode) group.append(popupItem(beatmap));
            content.append(group);
        }

        node.append(content);

        return node;
    }

    function hidePopup() {
        if (popupPanel) popupPanel.classList.remove('beatmapset-panel--beatmaps-popup-visible');
        if (popup) popup.remove();

        popup = null;
        popupPanel = null;
    }

    function sweepPopups() {
        for (const node of document.querySelectorAll(`.${PREFIX}__popup`)) {
            if (node !== popup) node.remove();
        }

        for (const panel of document.querySelectorAll(`.${PREFIX}__panel.beatmapset-panel--beatmaps-popup-visible`)) {
            if (panel !== popupPanel) panel.classList.remove('beatmapset-panel--beatmaps-popup-visible');
        }
    }

    function showPopup(root, set) {
        hidePopup();

        const box = root.getBoundingClientRect();

        popup = buildPopup(set);
        popup.style.opacity = '0';
        popup.style.transitionDuration = '150ms';
        popup.style.width = `${box.width}px`;
        popup.style.setProperty('--panel-height', `${box.height}px`);

        popup.style.left = '0px';
        popup.style.top = '0px';

        portal().append(popup);

        const landed = popup.getBoundingClientRect();
        popup.style.left = `${box.left - landed.left}px`;
        popup.style.top = `${box.bottom - landed.top}px`;

        popup.addEventListener('mouseleave', (e) => {
            if (popupPanel && popupPanel.contains(e.relatedTarget)) return;
            hidePopup();
        });

        popupPanel = root;
        root.classList.add('beatmapset-panel--beatmaps-popup-visible');

        requestAnimationFrame(() => {
            if (popup) popup.style.opacity = '1';
        });
    }

    function cover(set, size) {
        const node = element('div', 'beatmapset-cover beatmapset-cover--full');

        node.style.setProperty('--bg-default', `var(--bg-default-${(set.id ?? 0) % 6})`);

        const normal = set.covers?.[size];
        const retina = set.covers?.[`${size}@2x`];

        if (normal) node.style.setProperty('--bg', `url("${normal}")`);
        if (retina) node.style.setProperty('--bg-2x', `url("${retina}")`);

        return node;
    }

    function href(set) {
        const mine = (set.beatmaps ?? [])
            .filter((b) => b.user_id === profileId)
            .sort((a, b) => (a.difficulty_rating ?? 0) - (b.difficulty_rating ?? 0))[0];

        return mine ? `/beatmapsets/${set.id}#${mine.mode}/${mine.id}` : `/beatmapsets/${set.id}`;
    }

    function mappedBy() {
        const row = document.querySelector('.beatmapset-panel__info-row--mapper .u-ellipsis-overflow');
        const name = row?.querySelector('a')?.textContent ?? '';
        const whole = row?.textContent ?? '';
        const at = name === '' ? -1 : whole.indexOf(name);

        return at > 0 ? whole.slice(0, at) : 'mapped by ';
    }

    function number(value) {
        return (value ?? 0).toLocaleString(JAPANESE ? 'ja-JP' : 'en-GB');
    }

    function beatmapsetBadge(set, type) {
        let url = null;

        switch (type) {
            case 'featured_artist':
                if (set.track_id == null) return null;
                url = `/beatmaps/artists/tracks/${set.track_id}`;
                break;

            case 'nsfw':
                if (!set.nsfw) return null;
                break;

            case 'spotlight':
                if (!set.spotlight) return null;
                url = '/wiki/Beatmap_Spotlights';
                break;
        }

        const mark = element(url == null ? 'span' : 'a', `beatmapset-badge beatmapset-badge--${type}`, BADGE_LABEL[type]);
        if (url != null) mark.href = url;

        return mark;
    }

    function panel(set) {
        const link = href(set);
        const hyped = set.hype != null;

        const root = element('div', `beatmapset-panel beatmapset-panel--size-${cardSize()}${hyped ? ' beatmapset-panel--with-hype-counts' : ''} js-audio--player ${PREFIX}__panel`);
        if (set.preview_url) root.dataset.audioUrl = set.preview_url;

        const covers = element('a', 'beatmapset-panel__cover-container');
        covers.href = link;

        for (const [col, size] of [['play', 'list'], ['info', 'card']]) {
            const column = element('div', `beatmapset-panel__cover-col beatmapset-panel__cover-col--${col}`);
            column.append(cover(set, size));
            covers.append(column);
        }

        const content = element('div', 'beatmapset-panel__content');

        const play = element('div', 'beatmapset-panel__play-container');
        const playButton = element('button', 'beatmapset-panel__play js-audio--play');
        playButton.type = 'button';
        playButton.append(element('span', 'play-button'));
        play.append(playButton);

        const info = element('div', 'beatmapset-panel__info');

        const original = preferOriginal();

        for (const [kind, text, marks] of [
            ['title', original ? (set.title_unicode || set.title) : (set.title || set.title_unicode), ['nsfw', 'spotlight']],
            ['artist', `by ${original ? (set.artist_unicode || set.artist) : (set.artist || set.artist_unicode)}`, ['featured_artist']],
        ]) {
            const row = element('div', `beatmapset-panel__info-row beatmapset-panel__info-row--${kind}`);
            const anchor = element('a', 'beatmapset-panel__main-link u-ellipsis-overflow', text ?? '');
            anchor.href = link;

            const badges = element('div', 'beatmapset-panel__badge-container');

            for (const type of marks) {
                const mark = beatmapsetBadge(set, type);
                if (mark != null) badges.append(mark);
            }

            row.append(anchor, badges);
            info.append(row);
        }

        const source = element('div', 'beatmapset-panel__info-row beatmapset-panel__info-row--source');
        source.append(element('div', 'u-ellipsis-overflow', set.source || ''));
        info.append(source);

        const mapper = element('div', 'beatmapset-panel__info-row beatmapset-panel__info-row--mapper');
        const mapperWrap = element('div', 'u-ellipsis-overflow', mappedBy());
        const mapperLink = element('a', 'js-usercard beatmapset-panel__mapper-link u-hover', set.creator ?? '');
        mapperLink.href = `/users/${set.user_id}`;
        mapperLink.dataset.userId = String(set.user_id);
        mapperWrap.append(mapperLink);
        mapper.append(mapperWrap);
        info.append(mapper);

        const stats = element('div', 'beatmapset-panel__info-row beatmapset-panel__info-row--stats');

        if (hyped) {
            stats.append(statsItem('hype', 'fas fa-bullhorn', number(set.hype?.current)));
            stats.append(statsItem('nominations', 'fas fa-thumbs-up', number(set.nominations_summary?.current)));
        }

        stats.append(statsItem('play-count', 'fas fa-play-circle', number(set.play_count)));
        stats.append(statsItem('favourite-count', 'far fa-heart', number(set.favourite_count)));

        const dated = element('div', 'beatmapset-panel__stats-item beatmapset-panel__stats-item--date');
        const dateIcon = element('span', 'beatmapset-panel__stats-item-icon');
        dateIcon.append(element('i', 'fa-fw fas fa-check-circle'));
        const time = element('time', 'js-tooltip-time', dateText(set.last_updated));
        if (set.last_updated) time.dateTime = set.last_updated;
        dated.append(dateIcon, time);
        stats.append(dated);

        info.append(stats);

        const extra = element('a', 'beatmapset-panel__info-row beatmapset-panel__info-row--extra');
        extra.href = link;

        const badgeItem = element('div', 'beatmapset-panel__extra-item');
        const badge = element('div', 'beatmapset-status beatmapset-status--panel', STATUS_LABEL[set.status] ?? set.status);
        badge.style.setProperty('--bg-hsl', `var(--beatmapset-${set.status}-bg-hsl)`);
        badge.style.setProperty('--colour', `var(--beatmapset-${set.status}-colour)`);
        badgeItem.append(badge);

        extra.append(badgeItem, dots(set));
        info.append(extra);

        extra.addEventListener('mouseenter', () => showPopup(root, set));

        root.addEventListener('mouseleave', (e) => {
            if (popup && popup.contains(e.relatedTarget)) return;
            hidePopup();
        });

        root.addEventListener('mousemove', (e) => {
            if (popupPanel !== root) return;

            const box = root.getBoundingClientRect();
            if (e.clientY < box.top + box.height / 2) hidePopup();
        });

        const menuContainer = element('div', 'beatmapset-panel__menu-container');
        const menu = element('div', 'beatmapset-panel__menu');
        const download = element('a', 'beatmapset-panel__menu-item');
        download.href = `/beatmapsets/${set.id}/download`;
        download.append(element('span', 'fas fa-file-download'));
        menu.append(download);
        menuContainer.append(menu);

        content.append(play, info, menuContainer);
        root.append(covers, content);

        return root;
    }

    function dateText(value) {
        if (!value) return '';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '';

        return parsed.toLocaleDateString(JAPANESE ? 'ja-JP' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function preferOriginal() {
        const shown = document.querySelector('.beatmapset-panel__info-row--artist .beatmapset-panel__main-link');
        if (!shown) return true;

        return /[^\x00-\x7f]/.test(shown.textContent ?? '');
    }

    function showMoreButton(section) {
        const button = element('button', `show-more-link show-more-link--profile-page ${PREFIX}__more`);
        button.type = 'button';
        button.disabled = section.loading;

        const spinner = element('span', 'show-more-link__spinner');
        spinner.append(element('span', 'la-ball-clip-rotate'));

        const label = element('span', 'show-more-link__label');

        for (const side of ['left', 'right']) {
            const icon = element('span', `show-more-link__label-icon show-more-link__label-icon--${side}`);
            icon.append(element('span', 'fas fa-angle-down'));

            if (side === 'left') {
                label.append(icon, element('span', 'show-more-link__label-text', section.loading ? LOADING : SHOW_MORE));
            } else {
                label.append(icon);
            }
        }

        button.append(spinner, label);
        button.addEventListener('click', () => expand(section));

        return button;
    }

    function draw(section) {
        const block = element('div', `${PREFIX}__section`);

        const heading = element('button', `${PREFIX}__heading`);
        heading.type = 'button';

        const title = element('h3', 'title title--page-extra-small', section.title);

        const whole = section.streams.every((s) => s.done);
        title.append(element('span', 'title__count', whole ? String(section.sets.length) : `${section.sets.length}+`));

        heading.append(title);

        heading.addEventListener('click', () => {
            section.folded = !section.folded;
            render();
        });

        block.append(heading);

        if (section.folded) return block;

        const list = element('div', 'page-extra__beatmapsets js-audio--group');
        for (const set of section.sets.slice(0, section.shown)) list.append(panel(set));
        block.append(list);

        if (section.sets.length > section.shown || section.streams.some((s) => !s.done)) {
            block.append(showMoreButton(section));
        }

        return block;
    }

    async function expand(section) {
        section.shown += PER_EXPANSION;
        section.loading = true;
        render();

        while (section.sets.length < section.shown && section.streams.some((s) => !s.done)) {
            await readMore(section);
        }

        section.loading = false;
        render();
    }

    function before(anchor) {
        const theirs = [...anchor.querySelectorAll('.page-extra__beatmapsets')]
            .filter((list) => !list.closest(`.${PREFIX}`));

        const heading = theirs[theirs.length - 1]?.previousElementSibling;

        return /nominat|ノミネート/i.test(heading?.textContent ?? '') ? heading : null;
    }

    function render() {
        hidePopup();

        const anchor = document.querySelector('.page-extra__beatmapsets')?.closest('.page-extra');
        if (!anchor) return;

        const existing = anchor.querySelector(`.${PREFIX}`);
        const host = existing ?? element('div', PREFIX);
        host.textContent = '';

        const drawn = sections.filter((section) => section.sets.length > 0);

        for (const section of drawn) host.append(draw(section));

        if (sections.some((s) => s.refused)) {
            host.append(element('div', `${PREFIX}__notice`, SIGNED_OUT_NOTICE));
        } else if (drawn.length === 0) {
            if (existing) existing.remove();
            return;
        }

        const nominated = before(anchor);

        if (nominated) nominated.parentElement.insertBefore(host, nominated);
        else anchor.append(host);
    }

    function style() {
        if (document.getElementById(`${PREFIX}-style`)) return;

        const css = element('style');
        css.id = `${PREFIX}-style`;
        css.textContent = `
            .${PREFIX}__section { margin-top: 30px; }
            .${PREFIX}__heading {
                display: flex; align-items: baseline; width: 100%;
                background: none; border: none; padding: 0; margin: 0; color: inherit; font: inherit;
                text-align: left; cursor: pointer;
            }
            .${PREFIX}__notice { color: hsl(var(--hsl-f1)); font-size: 12px; margin-top: 10px; }
        `;

        document.head.append(css);
    }

    function idFromPage() {
        const fromPath = location.pathname.match(/^\/users\/(\d+)/);
        if (fromPath) return Number(fromPath[1]);

        const canonical = document.querySelector('link[rel="canonical"]')?.href ?? '';
        const fromCanonical = canonical.match(/\/users\/(\d+)/);

        return fromCanonical ? Number(fromCanonical[1]) : null;
    }

    async function start() {
        sections = SECTIONS.map((section) => ({
            ...section,
            sets: [],
            shown: INITIAL,
            loading: false,
            folded: false,
            refused: false,
            streams: section.states.map((state) => ({ state, cursor: null, done: false })),
        }));

        for (const section of sections) {
            await readMore(section);
        }

        render();
    }

    let started = false;
    let address = location.pathname;

    function tick() {
        sweepPopups();

        if (location.pathname !== address) {
            address = location.pathname;
            started = false;
            profileId = null;
        }

        if (started) {
            if (sections && !document.querySelector(`.${PREFIX}`)) render();
            return;
        }

        if (!document.querySelector('.page-extra__beatmapsets')) return;

        profileId = idFromPage();
        if (!profileId) return;

        started = true;
        style();
        start().catch((error) => console.error('[ゲスト難易度]', error));
    }

    window.addEventListener('pagehide', hidePopup);

    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 1000);
    tick();
})();
