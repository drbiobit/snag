#!/usr/bin/env python3
"""
YouTube Video to Transcript Converter
Downloads the transcript of a YouTube video and saves it as a .md file
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        TranscriptsDisabled,
        NoTranscriptFound,
        VideoUnavailable,
    )
except ImportError:
    print("Error: youtube-transcript-api is not installed.")
    print("Install it with: pip install youtube-transcript-api")
    sys.exit(1)


def extract_video_id(url_or_id: str) -> str:
    """Extract the 11-character video ID from various YouTube URL formats."""
    # Already an ID
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id

    patterns = [
        r"(?:youtube\.com/watch\?v=)([A-Za-z0-9_-]{11})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/v/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/live/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)

    raise ValueError(f"Could not extract video ID from: {url_or_id}")


def format_timestamp(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def get_transcript(video_id: str, languages: list = None):
    """Fetch transcript for a video, preferring manual over auto-generated."""
    languages = languages or ["en"]

    try:
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        # Try to find a manually created transcript first
        transcript = None
        for lang in languages:
            try:
                transcript = transcript_list.find_manually_created_transcript([lang])
                break
            except Exception:
                continue

        # Fall back to any transcript (auto-generated)
        if transcript is None:
            for lang in languages:
                try:
                    transcript = transcript_list.find_transcript([lang])
                    break
                except Exception:
                    continue

        # Last resort: grab whatever is available
        if transcript is None:
            transcript = next(iter(transcript_list))

        fetched = transcript.fetch()
        return fetched, transcript.language, transcript.is_generated

    except TranscriptsDisabled:
        print(f"Error: Transcripts are disabled for video {video_id}")
        sys.exit(1)
    except NoTranscriptFound:
        print(f"Error: No transcript found for video {video_id} in {languages}")
        sys.exit(1)
    except VideoUnavailable:
        print(f"Error: Video {video_id} is unavailable")
        sys.exit(1)


def build_markdown(video_id: str, url: str, language: str, is_generated: bool,
                   segments, include_timestamps: bool = True) -> str:
    """Build the Markdown output."""
    lines = []

    lines.append(f"# YouTube Transcript")
    lines.append("")
    lines.append(f"- **Video URL:** {url}")
    lines.append(f"- **Video ID:** `{video_id}`")
    lines.append(f"- **Language:** {language}")
    lines.append(f"- **Transcript type:** {'Auto-generated' if is_generated else 'Manual'}")
    lines.append(f"- **Extracted on:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    lines.append("---")
    lines.append("")

    if include_timestamps:
        lines.append("## Transcript (with timestamps)")
        lines.append("")
        for seg in segments:
            text = seg.text.replace("\n", " ").strip()
            ts = format_timestamp(seg.start)
            lines.append(f"**[{ts}]** {text}")
            lines.append("")
    else:
        lines.append("## Transcript")
        lines.append("")

    # Also always append a clean, continuous version
    lines.append("---")
    lines.append("")
    lines.append("## Full Text (continuous)")
    lines.append("")
    full_text = " ".join(seg.text.replace("\n", " ").strip() for seg in segments)
    # Clean up extra spaces
    full_text = re.sub(r"\s+", " ", full_text).strip()
    lines.append(full_text)
    lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Convert a YouTube video's transcript into a Markdown file."
    )
    parser.add_argument("url", help="YouTube video URL or video ID")
    parser.add_argument(
        "-o", "--output",
        help="Output .md file path (default: <video_id>_transcript.md)",
        default=None,
    )
    parser.add_argument(
        "-l", "--languages",
        nargs="+",
        default=["en"],
        help="Preferred languages in order (default: en)",
    )
    parser.add_argument(
        "--no-timestamps",
        action="store_true",
        help="Omit timestamped transcript section",
    )
    args = parser.parse_args()

    try:
        video_id = extract_video_id(args.url)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"Fetching transcript for video: {video_id}")

    segments, language, is_generated = get_transcript(video_id, args.languages)
    print(f"Found {language} transcript ({'auto-generated' if is_generated else 'manual'}), "
          f"{len(segments)} segments")

    md = build_markdown(
        video_id=video_id,
        url=url,
        language=language,
        is_generated=is_generated,
        segments=segments,
        include_timestamps=not args.no_timestamps,
    )

    output_path = Path(args.output or f"{video_id}_transcript.md")
    output_path.write_text(md, encoding="utf-8")
    print(f"✓ Transcript saved to: {output_path.resolve()}")


if __name__ == "__main__":
    main()

