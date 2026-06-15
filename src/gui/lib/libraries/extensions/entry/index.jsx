/**
 * This is an extension for Xcratch.
 */

import iconURL from './entry-icon.png';
import insetIconURL from './inset-icon.svg';
import translations from './translations.json';
import {version as packageVersion} from '../../../../../../package.json';

/**
 * Formatter to translate the messages in this extension.
 * This will be replaced which is used in the React component.
 * @param {object} messageData - data for format-message
 * @returns {string} - translated message for the current locale
 */
let formatMessage = messageData => messageData.defaultMessage;

const version = `v${packageVersion}`;

const entry = {
    get name () {
        return formatMessage({
            id: 'weatherForecast.entry.name',
            defaultMessage: '天気予報',
            description: 'name of the extension'
        });
    },
    extensionId: 'weatherForecast',
    extensionURL: 'https://asondemita.github.io/xcx-weather/dist/weatherForecast.mjs',
    collaborator: 'asondemita',
    iconURL: iconURL,
    insetIconURL: insetIconURL,
    get description () {
        return `${formatMessage({
            defaultMessage: '郵便番号からn時間後の気温・降水確率・天気・風速を取得します（Open-Meteo を使用）。',
            description: 'Description for this extension',
            id: 'weatherForecast.entry.description'
        })} (${version})`;
    },
    tags: [],
    featured: true,
    disabled: false,
    bluetoothRequired: false,
    internetConnectionRequired: true,
    helpLink: 'https://asondemita.github.io/xcx-weather/',
    setFormatMessage: formatter => {
        formatMessage = formatter;
    },
    translationMap: translations
};

export {entry}; // loadable-extension needs this line.
export default entry;
