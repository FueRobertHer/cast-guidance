/**
 * The one figure the app quotes for the compendium download, wherever it is
 * quoted: what a full install sends over the network, rounded up so it never
 * undersells. Measured from jsDelivr against v2.39.1: 1,626,177 bytes (1.55 MiB)
 * across the 50 files.
 *
 * It is not what ends up on the device. The CDN compresses the files and they
 * unpack to about 8.4 MiB of JSON, which is the figure Settings counts.
 */
export const GAME_DATA_DOWNLOAD_SIZE = '1.6 MB';
