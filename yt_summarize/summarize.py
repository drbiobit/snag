#!/usr/bin/env python3
"""
Local AI Summarizer
Sends a content file + system prompt to a local OpenAI-compatible endpoint
and saves the resulting Markdown article to disk.

Usage:
    python summarize.py content.md
    python summarize.py transcript.md --system system_prompt.md --output article.md
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' is not installed. Run: pip install requests")
    sys.exit(1)


# No hardcoded endpoint: the caller (snag backend) always passes --endpoint.
# The system prompt is also passed in as text (--system-prompt) - it lives in
# the app's database, not in a file.
DEFAULT_TIMEOUT = 300  # 5 minutes


# ---------- Helpers ----------

def fetch_models(endpoint: str, timeout: int = 15):
    """Fetch available model IDs from an OpenAI-compatible endpoint."""
    url = endpoint.rstrip("/") + "/models"
    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()
        data = r.json()
        models = [m.get("id") for m in data.get("data", []) if m.get("id")]
        return sorted(models)
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Could not fetch models from {url}: {e}")
        return []


def choose_model_interactively(models):
    """Let the user pick a model from the list, or type one manually."""
    if not models:
        return input("Enter model name manually: ").strip()

    print("\n📦 Available models:")
    for i, m in enumerate(models, 1):
        print(f"  [{i}] {m}")
    print(f"  [0] Enter manually")

    while True:
        choice = input("\n👉 Choose a model number: ").strip()
        if choice == "0":
            manual = input("Enter model name: ").strip()
            if manual:
                return manual
            continue
        try:
            idx = int(choice)
            if 1 <= idx <= len(models):
                return models[idx - 1]
        except ValueError:
            pass
        print("❌ Invalid choice, try again.")


def chat_completion(endpoint, model, system_prompt, user_content,
                    timeout=300, temperature=0.4, api_key=""):
    """Send a chat completion request to the endpoint."""
    url = endpoint.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    print(f"\n⏳ Sending request to {url}")
    print(f"   Model: {model}")
    print(f"   Timeout: {timeout}s (waiting for model to load if needed)...")

    start = time.time()
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=timeout)
        elapsed = time.time() - start
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        print(f"✅ Response received in {elapsed:.1f}s")
        if usage:
            print(f"   Tokens — prompt: {usage.get('prompt_tokens', '?')}, "
                  f"completion: {usage.get('completion_tokens', '?')}, "
                  f"total: {usage.get('total_tokens', '?')}")
        return content
    except requests.exceptions.Timeout:
        print(f"❌ Request timed out after {timeout}s. "
              f"The model may still be loading — try increasing timeout.")
        sys.exit(1)
    except requests.exceptions.ConnectionError as e:
        print(f"❌ Could not connect to {url}: {e}")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP error {r.status_code}: {r.text[:500]}")
        sys.exit(1)
    except (KeyError, json.JSONDecodeError) as e:
        print(f"❌ Bad response format: {e}")
        print(f"   Raw: {r.text[:500]}")
        sys.exit(1)


# ---------- Main ----------

def main():
    parser = argparse.ArgumentParser(
        description="Summarize a file using a local OpenAI-compatible AI endpoint."
    )
    parser.add_argument("content_file", help="Path to the content/transcript file")
    parser.add_argument(
        "--system-prompt", "-s",
        default=None,
        required=True,
        help="The system prompt text (provided by the caller)",
    )
    parser.add_argument(
        "--endpoint", "-e",
        default=None,
        required=True,
        help="OpenAI-compatible endpoint (e.g. http://localhost:8080/v1)",
    )
    parser.add_argument(
        "--api-key",
        default="",
        help="Optional API key, sent as a Bearer token (blank = no auth)",
    )
    parser.add_argument(
        "--model", "-m",
        default=None,
        help="Model name (skip interactive selection)",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output .md file path (default: <content_stem>_summary.md)",
    )
    parser.add_argument(
        "--timeout", "-t",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.4,
        help="Sampling temperature (default: 0.4)",
    )
    args = parser.parse_args()

    # --- Load content ---
    content_path = Path(args.content_file)
    if not content_path.exists():
        print(f"❌ Content file not found: {content_path}")
        sys.exit(1)
    content = content_path.read_text(encoding="utf-8")
    print(f"📄 Loaded content: {content_path} ({len(content):,} chars)")

    # --- System prompt (provided as text by the caller) ---
    system_prompt = args.system_prompt.strip()
    if not system_prompt:
        print("❌ Empty system prompt")
        sys.exit(1)
    print(f"🧠 System prompt: {len(system_prompt):,} chars")

    # --- Choose model ---
    if args.model:
        model = args.model
        print(f"🎯 Using model: {model}")
    else:
        print(f"\n🔎 Querying models from {args.endpoint} ...")
        models = fetch_models(args.endpoint)
        model = choose_model_interactively(models)
        print(f"🎯 Selected model: {model}")

    # --- Build user message ---
    user_content = (
        f"Here is the source content from the file `{content_path.name}`. "
        f"Please transform it into a comprehensive Markdown article "
        f"following your system instructions exactly.\n\n"
        f"--- BEGIN SOURCE CONTENT ---\n\n"
        f"{content}\n\n"
        f"--- END SOURCE CONTENT ---"
    )

    # --- Call AI ---
    result = chat_completion(
        endpoint=args.endpoint,
        model=model,
        system_prompt=system_prompt,
        user_content=user_content,
        timeout=args.timeout,
        temperature=args.temperature,
        api_key=args.api_key,
    )

    # --- Save output ---
    output_path = Path(args.output) if args.output else \
        content_path.with_name(content_path.stem + "_summary.md")

    # Add generation footer if the model didn't
    if "Generated by Local AI Summarizer" not in result:
        result = result.rstrip() + (
            f"\n\n---\n\n*Generated by Local AI Summarizer · "
            f"model: `{model}` · {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n"
        )

    output_path.write_text(result, encoding="utf-8")
    print(f"\n💾 Saved article to: {output_path.resolve()}")
    print(f"   Size: {len(result):,} chars")


if __name__ == "__main__":
    main()

