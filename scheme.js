import { customPalette } from './appearance.js';

export const SCHEMES = ['system', 'light', 'dark'];
export const resolveScheme = (scheme, systemDark) => scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme;
const COLORS = {
    dark: {
        amber: ['#dbc291', '#25211e', '#f0e9dc'], ocean: ['#8bcaee', '#202b36', '#e4f2fc'],
        forest: ['#a2d7b7', '#1f3028', '#e4f5e9'], rose: ['#efadc3', '#36252d', '#ffedf0'],
        lavender: ['#c5b3ed', '#2b263b', '#f0eafe'], pearl: ['#cfb7ca', '#2f2730', '#f6edf4'],
    },
    light: {
        amber: ['#93662d', '#f7f1e6', '#3a3023'], ocean: ['#327da5', '#eaf3f8', '#203746'],
        forest: ['#4a7e5a', '#edf5ef', '#294034'], rose: ['#a35877', '#faeff3', '#49313c'],
        lavender: ['#8060a5', '#f3eff9', '#3d3251'], pearl: ['#8a6480', '#f3f0ea', '#302f36'],
    },
};
export function themePalette(theme, scheme) {
    const [accent, background, text] = COLORS[scheme]?.[theme] || COLORS.dark.amber;
    return customPalette({ accent, background, text });
}
