/**
 * The one figure the app quotes for the compendium download, wherever it is
 * quoted. It is the cached size rounded up, so it never undersells what lands
 * on the device; the wire transfer is a little smaller because the CDN
 * compresses it.
 */
export const GAME_DATA_DOWNLOAD_SIZE = '2.5 MB';
