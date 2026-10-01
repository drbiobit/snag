# YT-DLP Command Line Flags Reference

## Overview

This document provides a comprehensive reference of all yt-dlp command-line flags and options. This is essential for building the web UI to properly pass parameters to yt-dlp.

**yt-dlp Version**: Feature-rich command-line audio/video downloader  
**Full Documentation**: https://github.com/yt-dlp/yt-dlp#readme

---

## 📋 Table of Contents

1. [General Options](#general-options)
2. [Video Selection](#video-selection)
3. [Download Options](#download-options)
4. [Filesystem Options](#filesystem-options)
5. [Format Selection](#format-selection)
6. [Post-Processing Options](#post-processing-options)
7. [Thumbnail Options](#thumbnail-options)
8. [Subtitle Options](#subtitle-options)
9. [Authentication Options](#authentication-options)
10. [Verbosity & Simulation](#verbosity--simulation)
11. [Workarounds](#workarounds)
12. [Extractor Options](#extractor-options)
13. [SponsorBlock Options](#sponsorblock-options)

---

## 🎛️ General Options

| Flag | Description |
|------|-------------|
| `-h, --help` | Print this help text and exit |
| `--version` | Print program version and exit |
| `-U, --update` | Update this program to the latest version |
| `--no-update` | Do not check for updates (default) |
| `--update-to [CHANNEL]@[TAG]` | Upgrade/downgrade to a specific version. Supported channels: stable, nightly, master |
| `-i, --ignore-errors` | Ignore download and postprocessing errors. Consider successful even if postprocessing fails |
| `--no-abort-on-error` | Continue with next video on download errors (default) |
| `--abort-on-error` | Abort downloading if an error occurs |
| `--list-extractors` | List all supported extractors and exit |
| `--extractor-descriptions` | Print descriptions for all extractors |
| `--simulate` | Do not download the video and do not write anything to disk |
| `--no-simulate` | Download the video even if printing/listing options are used |

---

## 🎬 Video Selection

| Flag | Description |
|------|-------------|
| `-I, --playlist-items ITEM_SPEC` | Comma-separated playlist indices to download. Supports ranges `[START]:[STOP][:STEP]`. Example: `-I 1:3,7,-5::2` |
| `--min-filesize SIZE` | Abort download if filesize is smaller than SIZE (e.g., 50k, 44.6M) |
| `--max-filesize SIZE` | Abort download if filesize is larger than SIZE |
| `--date DATE` | Download only videos uploaded on this date. Format: `YYYYMMDD` or `now|today|yesterday[-N[day|week|month|year]]` |
| `--datebefore DATE` | Download only videos uploaded on or before this date |
| `--dateafter DATE` | Download only videos uploaded on or after this date |
| `--match-filters FILTER` | Generic video filter. Compare OUTPUT TEMPLATE fields with operators |
| `--no-match-filters` | Do not use any --match-filters (default) |
| `--break-match-filters FILTER` | Same as --match-filters but stops download when video is rejected |
| `--no-playlist` | Download only the video, if URL refers to video and playlist |
| `--yes-playlist` | Download the playlist, if URL refers to video and playlist |
| `--age-limit YEARS` | Download only videos suitable for the given age |
| `--download-archive FILE` | Download only videos not listed in archive file. Record IDs of all downloaded videos |
| `--no-download-archive` | Do not use archive file (default) |
| `--max-downloads NUMBER` | Abort after downloading NUMBER files |
| `--break-on-existing` | Stop download process when encountering file in archive |
| `--no-break-on-existing` | Do not stop when encountering existing file (default) |
| `--skip-playlist-after-errors N` | Number of allowed failures until rest of playlist is skipped |

---

## 📥 Download Options

| Flag | Description |
|------|-------------|
| `-N, --concurrent-fragments N` | Number of fragments of DASH/HLS video downloaded concurrently (default: 1) |
| `-r, --limit-rate RATE` | Maximum download rate in bytes per second (e.g., 50K, 4.2M) |
| `--throttled-rate RATE` | Minimum download rate below which throttling is assumed |
| `-R, --retries RETRIES` | Number of retries (default: 10), or "infinite" |
| `--file-access-retries RETRIES` | Number of times to retry on file access error (default: 3) |
| `--fragment-retries RETRIES` | Number of retries for a fragment (default: 10) |
| `--retry-sleep [TYPE:]EXPR` | Time to sleep between retries in seconds |
| `--skip-unavailable-fragments` | Skip unavailable fragments for DASH, hlsnative, ISM (default) |
| `--abort-on-unavailable-fragments` | Abort download if fragment unavailable |
| `--keep-fragments` | Keep downloaded fragments on disk after download |
| `--no-keep-fragments` | Delete fragments after download (default) |
| `--buffer-size SIZE` | Size of download buffer (default: 1024) |
| `--resize-buffer` | Automatically resize buffer from initial value |
| `--playlist-random` | Download playlist videos in random order |
| `--lazy-playlist` | Process playlist entries as they are received |
| `--no-lazy-playlist` | Process videos after entire playlist is parsed (default) |
| `--hls-use-mpegts` | Use mpegts container for HLS videos (default for live streams) |
| `--no-hls-use-mpegts` | Do not use mpegts container |
| `--download-sections REGEX` | Download only chapters matching regular expression |
| `--downloader [PROTO:]NAME` | Name of external downloader (native, aria2c, axel, curl, ffmpeg, httpie, wget) |
| `--downloader-args NAME:ARGS` | Give arguments to external downloader |

---

## 📁 Filesystem Options

| Flag | Description |
|------|-------------|
| `-a, --batch-file FILE` | File containing URLs to download (one per line). Use "-" for stdin |
| `--no-batch-file` | Do not read URLs from batch file (default) |
| `-P, --paths [TYPES:]PATH` | Paths where files should be downloaded. Supports "home" and "temp" types |
| `-o, --output [TYPES:]TEMPLATE` | Output filename template. See OUTPUT TEMPLATE section |
| `--output-na-placeholder TEXT` | Placeholder for unavailable fields in --output (default: "NA") |
| `--restrict-filenames` | Restrict filenames to ASCII characters, avoid "&" and spaces |
| `--no-restrict-filenames` | Allow Unicode characters, "&" and spaces (default) |
| `--windows-filenames` | Force filenames to be Windows-compatible |
| `--no-windows-filenames` | Sanitize filenames minimally (default) |
| `--trim-filenames LENGTH` | Limit filename length (excluding extension) |
| `-w, --no-overwrites` | Do not overwrite any files |
| `--force-overwrites` | Overwrite all video and metadata files (includes --no-continue) |
| `--no-force-overwrites` | Do not overwrite video, but overwrite related files (default) |
| `-c, --continue` | Resume partially downloaded files/fragments (default) |
| `--no-continue` | Do not resume partially downloaded fragments |
| `--part` | Use .part files instead of writing directly into output file (default) |
| `--no-part` | Do not use .part files - write directly into output file |
| `--mtime` | Use Last-modified header to set file modification time |
| `--no-mtime` | Do not use Last-modified header (default) |
| `--write-description` | Write video description to .description file |
| `--no-write-description` | Do not write video description (default) |
| `--write-info-json` | Write video metadata to .info.json file |
| `--no-write-info-json` | Do not write video metadata (default) |
| `--write-playlist-metafiles` | Write playlist metadata with --write-info-json (default) |
| `--no-write-playlist-metafiles` | Do not write playlist metadata |
| `--clean-info-json` | Remove internal metadata from infojson (default) |
| `--no-clean-info-json` | Write all fields to infojson |
| `--write-comments` | Retrieve video comments for infojson |
| `--no-write-comments` | Do not retrieve comments |
| `--load-info-json FILE` | JSON file containing video information (created with --write-info-json) |
| `--cookies FILE` | Netscape formatted file to read cookies from |
| `--no-cookies` | Do not read/dump cookies from/to file (default) |
| `--cookies-from-browser BROWSER` | Load cookies from browser (brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale) |
| `--no-cookies-from-browser` | Do not load cookies from browser (default) |
| `--cache-dir DIR` | Location for yt-dlp cache files (default: ${XDG_CACHE_HOME}/yt-dlp) |
| `--no-cache-dir` | Disable filesystem caching |
| `--rm-cache-dir` | Delete all filesystem cache files |

---

## 🎨 Format Selection

| Flag | Description |
|------|-------------|
| `-f, --format FORMAT` | Video format code. See FORMAT SELECTION for details |
| `-S, --format-sort SORTORDER` | Sort formats by given fields |
| `--format-sort-reset` | Disregard previous user specified sort order |
| `--format-sort-force` | Force user specified sort order to have precedence |
| `--no-format-sort-force` | Some fields have precedence over user sort (default) |
| `--video-multistreams` | Allow multiple video streams to be merged |
| `--no-video-multistreams` | Only one video stream per output file (default) |
| `--audio-multistreams` | Allow multiple audio streams to be merged |
| `--no-audio-multistreams` | Only one audio stream per output file (default) |
| `--prefer-free-formats` | Prefer video formats with free containers |
| `--no-prefer-free-formats` | Don't give preference to free containers (default) |
| `--check-formats` | Make sure formats are selected from downloadable ones |
| `--check-all-formats` | Check all formats for downloadability |
| `--no-check-formats` | Don't check formats (default) |
| `-F, --list-formats` | List available formats of each video |
| `--merge-output-format FORMAT` | Containers for merging formats (avi, flv, mkv, mov, mp4, webm) |

### Common Format Codes

| Code | Description |
|------|-------------|
| `best` | Best video available |
| `bestaudio` | Best audio available |
| `w*` | WebM format |
| `mp4*` | MP4 format |
| `1080` | 1080p resolution |
| `720` | 720p resolution |
| `540` | 540p resolution |
| `ba` | Best audio |
| `bv*` | Best video |
| `b*` | Any video |
| `a*` | Any audio |
| `bestvideo+bestaudio` | Best video + best audio merged |
| `bestvideo/best` | Best video or best available |

---

## 🎵 Post-Processing Options

| Flag | Description |
|------|-------------|
| `-x, --extract-audio` | Convert video files to audio-only files (requires ffmpeg) |
| `--audio-format FORMAT` | Format to convert audio to when -x is used (best, aac, alac, flac, m4a, mp3, opus, vorbis, wav) |
| `--audio-quality QUALITY` | Specify ffmpeg audio quality (0=best to 10=worst for VBR, or bitrate like 128K). Default: 5 |
| `--remux-video FORMAT` | Remux video into another container (avi, flv, gif, mkv, mov, mp4, webm, aac, flac, m4a, mka, mp3, ogg, opus, vorbis, wav) |
| `--recode-video FORMAT` | Re-encode video into another format if necessary |
| `--postprocessor-args NAME:ARGS` | Give arguments to postprocessors. Supported: Merger, ModifyChapters, SplitChapters, ExtractAudio, VideoRemuxer, VideoConvertor, Metadata, EmbedSubtitle, EmbedThumbnail, SubtitlesConvertor, ThumbnailsConvertor, FixupStretched, FixupM4a, FixupM3u8, FixupTimestamp, FixupDuration |
| `-k, --keep-video` | Keep intermediate video file on disk after post-processing |
| `--no-keep-video` | Delete intermediate video file (default) |
| `--post-overwrites` | Overwrite post-processed files (default) |
| `--no-post-overwrites` | Do not overwrite post-processed files |
| `--embed-subs` | Embed subtitles in video (only for mp4, webm, mkv) |
| `--no-embed-subs` | Do not embed subtitles (default) |
| `--embed-thumbnail` | Embed thumbnail in video as cover art |
| `--no-embed-thumbnail` | Do not embed thumbnail (default) |
| `--embed-metadata` | Embed metadata to video file (Alias: --add-metadata) |
| `--no-embed-metadata` | Do not add metadata (default) |
| `--embed-chapters` | Add chapter markers to video file (Alias: --add-chapters) |
| `--no-embed-chapters` | Do not add chapter markers (default) |
| `--embed-info-json` | Embed infojson as attachment to mkv/mka files |
| `--no-embed-info-json` | Do not embed infojson |
| `--parse-metadata [WHEN:]FROM:TO` | Parse additional metadata like title/artist from other fields |
| `--replace-in-metadata [WHEN:]FIELDS REGEX REPLACE` | Replace text in metadata field using regex |
| `--xattrs` | Write metadata to video file's xattrs |
| `--concat-playlist POLICY` | Concatenate videos in playlist (never, always, multi_video). Default: multi_video |
| `--fixup POLICY` | Automatically correct known faults (never, warn, detect_or_warn, force). Default: detect_or_warn |
| `--ffmpeg-location PATH` | Location of ffmpeg binary |
| `--exec [WHEN:]CMD` | Execute a command after download |
| `--no-exec` | Remove any previously defined --exec |
| `--convert-subs FORMAT` | Convert subtitles to another format (ass, lrc, srt, vtt). Use "none" to disable |
| `--convert-thumbnails FORMAT` | Convert thumbnails (jpg, png, webp). Use "none" to disable |
| `--split-chapters` | Split video into multiple files based on chapters |
| `--no-split-chapters` | Do not split based on chapters (default) |
| `--remove-chapters REGEX` | Remove chapters whose title matches regex |
| `--no-remove-chapters` | Do not remove chapters (default) |
| `--force-keyframes-at-cuts` | Force keyframes at cuts (slow, requires re-encode) |
| `--no-force-keyframes-at-cuts` | Do not force keyframes (default) |
| `--use-postprocessor NAME[:ARGS]` | Enable plugin postprocessors with optional arguments |

### MP3 Conversion Examples

```bash
# Basic MP3 conversion
yt-dlp -x --audio-format mp3 URL

# High quality MP3 (320kbps)
yt-dlp -x --audio-format mp3 --audio-quality 0 URL

# Standard quality MP3 (128kbps)
yt-dlp -x --audio-format mp3 --audio-quality 4 --postprocessor-args ExtractAudio:ffmpeg:-b:a 128k URL
```

---

## 🖼️ Thumbnail Options

| Flag | Description |
|------|-------------|
| `--write-thumbnail` | Write thumbnail image to disk |
| `--no-write-thumbnail` | Do not write thumbnail image (default) |
| `--write-all-thumbnails` | Write all thumbnail image formats to disk |
| `--list-thumbnails` | List available thumbnails of each video |

---

## 📝 Subtitle Options

| Flag | Description |
|------|-------------|
| `--write-subs` | Write subtitle file |
| `--no-write-subs` | Do not write subtitle file (default) |
| `--write-auto-subs` | Write automatically generated subtitle file (Alias: --write-automatic-subs) |
| `--no-write-auto-subs` | Do not write auto-generated subtitles (default) |
| `--list-subs` | List available subtitles of each video |
| `--sub-format FORMAT` | Subtitle format preference separated by "/", e.g., "srt" or "ass/srt/best" |
| `--sub-langs LANGS` | Languages of subtitles to download (can be regex or "all"). Use "-" to exclude. Example: `--sub-langs "en.*,ja"` |

---

## 🔐 Authentication Options

| Flag | Description |
|------|-------------|
| `-u, --username USERNAME` | Login with this account ID |
| `-p, --password PASSWORD` | Account password. If omitted, yt-dlp will ask interactively |
| `-2, --twofactor TWOFACTOR` | Two-factor authentication code |
| `-n, --netrc` | Use .netrc authentication data |
| `--netrc-location PATH` | Location of .netrc authentication data |
| `--netrc-cmd NETRC_CMD` | Command to execute to get credentials |
| `--video-password PASSWORD` | Video-specific password |
| `--ap-mso MSO` | Adobe Pass multiple-system operator (TV provider) identifier |
| `--ap-username USERNAME` | Multiple-system operator account login |
| `--ap-password PASSWORD` | Multiple-system operator account password |
| `--ap-list-mso` | List all supported multiple-system operators |
| `--client-certificate CERTFILE` | Path to client certificate file in PEM format |
| `--client-certificate-key KEYFILE` | Path to private key file |
| `--client-certificate-password PASSWORD` | Password for client certificate private key |

---

## 🔊 Verbosity & Simulation

| Flag | Description |
|------|-------------|
| `-q, --quiet` | Activate quiet mode |
| `--no-quiet` | Deactivate quiet mode (Default) |
| `--no-warnings` | Ignore warnings |
| `-s, --simulate` | Do not download, do not write to disk |
| `--no-simulate` | Download even if printing/listing (default) |
| `--ignore-no-formats-error` | Ignore "No video formats" error |
| `--no-ignore-no-formats-error` | Throw error when no formats found (default) |
| `--skip-download` | Do not download but write all related files (Alias: --no-download) |
| `-O, --print [WHEN:]TEMPLATE` | Print field name or output template to screen |
| `-j, --dump-json` | Quiet, print JSON information for each video |
| `-J, --dump-single-json` | Quiet, print JSON for each URL or infojson |
| `--newline` | Output progress bar as new lines |
| `--no-progress` | Do not print progress bar |
| `--progress` | Show progress bar, even if in quiet mode |
| `--console-title` | Display progress in console titlebar |
| `--progress-template [TYPES:]TEMPLATE` | Template for progress outputs |
| `--progress-delta SECONDS` | Time between progress output (default: 0) |
| `-v, --verbose` | Print various debugging information |
| `--dump-pages` | Print downloaded pages encoded using base64 |
| `--write-pages` | Write downloaded pages to files |
| `--print-traffic` | Display sent and read HTTP traffic |

---

## 🛠️ Workarounds

| Flag | Description |
|------|-------------|
| `--encoding ENCODING` | Force the specified encoding (experimental) |
| `--legacy-server-connect` | Allow HTTPS connection to servers without RFC 5746 support |
| `--no-check-certificates` | Suppress HTTPS certificate validation |
| `--prefer-insecure` | Use unencrypted connection |
| `--add-headers FIELD:VALUE` | Specify custom HTTP header |
| `--bidi-workaround` | Work around terminals lacking bidirectional text support |
| `--sleep-requests SECONDS` | Seconds to sleep between requests during extraction |
| `--sleep-interval SECONDS` | Seconds to sleep before each download (Alias: --min-sleep-interval) |
| `--max-sleep-interval SECONDS` | Maximum seconds to sleep. Use with --min-sleep-interval |
| `--sleep-subtitles SECONDS` | Seconds to sleep before each subtitle download |

---

## 📺 Extractor Options

| Flag | Description |
|------|-------------|
| `--extractor-retries RETRIES` | Retries for known extractor errors (default: 3) |
| `--allow-dynamic-mpd` | Process dynamic DASH manifests (default) |
| `--ignore-dynamic-mpd` | Do not process dynamic DASH manifests |
| `--hls-split-discontinuity` | Split HLS playlists at discontinuities (ad breaks) |
| `--no-hls-split-discontinuity` | Do not split HLS playlists (default) |
| `--extractor-args IE_KEY:ARGS` | Pass arguments to specific extractor |

---

## 🎁 SponsorBlock Options

| Flag | Description |
|------|-------------|
| `--sponsorblock-mark CATS` | Create chapters for SponsorBlock categories (sponsor, intro, outro, selfpromo, preview, filler, interaction, music_offtopic, hook, poi_highlight, chapter, all, default). Separate by commas |
| `--sponsorblock-remove CATS` | Remove SponsorBlock categories from video file |
| `--sponsorblock-chapter-title TEMPLATE` | Template for SponsorBlock chapter titles. Fields: start_time, end_time, category, categories, name, category_names |
| `--no-sponsorblock` | Disable both mark and remove |
| `--sponsorblock-api URL` | SponsorBlock API location (default: https://sponsor.ajay.app) |

---

## 📚 Output Template

The `-o` or `--output` option uses templates to define output filenames. Available fields:

### Video Fields
- `%(title)s` - Video title
- `%(uploader)s` - Channel name
- `%(upload_date)s` - Upload date (YYYYMMDD)
- `%(id)s` - Video ID
- `%(duration)s` - Duration in seconds
- `%(ext)s` - File extension
- `%(format_id)s` - Format ID
- `%(resolution)s` - Resolution (e.g., 1080p)
- `%(fps)s` - Frames per second
- `%(filesize)s` - File size in bytes
- `%(timestamp)s` - Video timestamp

### Example Output Templates

```bash
# Default template
-o "%(uploader)s/%(title)s.%(ext)s"

# With date and ID
-o "%(upload_date)s/%(id)s - %(title)s.%(ext)s"

# For MP3 conversion
-o "%(uploader)s/%(title)s.%(audio_ext)s"

# Playlist with counter
-o "%(playlist)s/%(playlist_index)s - %(title)s.%(ext)s"

# Restricted filenames (ASCII only)
-o "%(uploader)s/%(title)s.%(ext)s" --restrict-filenames
```

---

## 🎯 Preset Aliases

yt-dlp provides preset aliases for convenience:

| Alias | Description |
|-------|-------------|
| `-t mp3` | Download as MP3 (best quality) |
| `-t aac` | Download as AAC audio |
| `-t mp4` | Download as MP4 with best video quality |
| `-t mkv` | Download as MKV container |
| `-t sleep` | Add sleep intervals between downloads |

### Example: MP3 Preset
```bash
yt-dlp -t mp3 -o "%(title)s.%(ext)s" URL
# Equivalent to:
yt-dlp -f 'ba[acodec^=mp3]/ba/b' -x --audio-format mp3 -o "%(title)s.%(ext)s" URL
```

---

## 💡 Quick Reference for Web UI

### For Single Video Download (Best Quality)
```bash
yt-dlp -f best -o "downloads/%(title)s.%(ext)s" URL
```

### For Playlist Download
```bash
yt-dlp --yes-playlist -f best -o "downloads/%(playlist)s/%(title)s.%(ext)s" URL
```

### For MP3 Conversion
```bash
yt-dlp -x --audio-format mp3 --audio-quality 5 -o "downloads/%(title)s.%(ext)s" URL
```

### For High Quality MP3 (320kbps)
```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 -o "downloads/%(title)s.%(ext)s" URL
```

### For Video + Audio (Merge)
```bash
yt-dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "downloads/%(title)s.%(ext)s" URL
```

---

## 🔧 Environment Variables

yt-dlp also respects these environment variables:

| Variable | Description |
|----------|-------------|
| `YTDLP_VERBOSE` | Set to "1" for verbose output |
| `YTDLP_QUIET` | Set to "1" for quiet mode |
| `YTDLP_NO_CACHE_DIR` | Disable caching |

---

## 📖 Additional Resources

- [Official yt-dlp GitHub](https://github.com/yt-dlp/yt-dlp)
- [Supported Sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- [Changelog](https://github.com/yt-dlp/yt-dlp/blob/master/Changelog.md)
- [Contributing Guide](https://github.com/yt-dlp/yt-dlp/blob/master/CONTRIBUTING.md)

---

**Last Updated**: 2024  
**Document Version**: 1.0
