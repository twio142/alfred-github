#!/usr/bin/env node
'use strict';
const {get} = require('axios');
const {decode} = require('he');

const warnEmpty = (message, warn=!0) => {
    let items = [{ title: message, valid: !1, icon: warn ? {path: '../../resources/AlertCautionIcon.icns'} : undefined }];
    process.stdout.write(JSON.stringify({items}));
}

const getIcon = (votes) => {
    let n = votes < 0 ?
        '-1' :
        votes == 0 ?
        '0' :
        votes < 10 ?
        '1-1' :
        votes < 50 ?
        '10' :
        votes < 100 ?
        '50' :
        votes < 500 ?
        '100' :
        votes < 1000 ?
        '500' :
        '1000';
    return `icons/so-${n}.png`;
}

const num = (number) => number >= 1e6 ? Math.round(number / 1e6) + 'M' : number >= 1000 ? Math.round(number / 1000) + 'k' : number;

(async (query) => {
    const {default: dateFormat} = await import('dateformat');
    const url = `https://api.stackexchange.com/2.1/search/advanced?order=desc&sort=votes&site=stackoverflow&q=${encodeURIComponent(query)}`;
    try {
        let {data: {items}} = await get(url, {headers: {'Accept-encoding': 'gzip'}});
        items = items.map(i => {
            return {
                title: decode(i.title),
                subtitle: `🔼 ${i.score}  ·  ${i.answer_count} answers  ·  viewed ${num(i.view_count)} times  ·  asked on ${dateFormat(i.creation_date*1000, 'yyyy-mm-dd')}`,
                arg: i.link,
                icon: {path: getIcon(i.score)}
            }
        });
        if (!items[0])
            throw new Error('Found No Result :/');
        process.stdout.write(JSON.stringify({items}));
    } catch(e) {
        console.error(e);
        warnEmpty(e.message);
    }
})(process.argv[2].trim());
