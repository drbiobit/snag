import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 21h16" /></svg>
    ),
    title: 'Single videos',
    desc: 'Best, 1080p, 720p or 480p — or pure audio with selectable bitrate and codec.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
    ),
    title: 'Bulk downloads',
    desc: 'Whole playlists, channels and user profiles in one go — resumable and cancelable.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M9 18V5l10-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>
    ),
    title: 'Audio extraction',
    desc: 'MP3, M4A, WAV, OGG and FLAC with selectable bitrate — 5 codecs, no CLI.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M12 3l1.9 4.8L18.7 9.7l-4.8 1.9L12 16.4l-1.9-4.8L5.3 9.7l4.8-1.9z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
    ),
    title: 'AI Summarize',
    desc: 'Turn any video into a clean Markdown article with your own OpenAI-compatible endpoint.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M22 12h-4l-3 8L9 4l-3 8H2" /></svg>
    ),
    title: 'Live progress',
    desc: 'Real-time per-file progress bars with bulk file-by-file tracking.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" /></svg>
    ),
    title: 'Resumable',
    desc: 'Interrupt a download and pick up where you left off — files on disk are skipped.',
  },
];

const docs = [
  { to: 'deployment', title: 'Deployment', desc: 'Docker, systemd, PM2, Mac/Windows, HTTPS & troubleshooting.' },
  { to: 'docker', title: 'Docker Deep-Dive', desc: 'Image internals, env vars, volumes, Compose and updates.' },
  { to: 'configuration', title: 'Configuration', desc: 'Every env var, the auth model and the full HTTP API.' },
  { to: 'code-reference', title: 'Code Reference', desc: 'A human-written walkthrough of snag.py and the frontend.' },
  { to: 'yt-dlp-flags', title: 'yt-dlp Flags', desc: 'Every yt-dlp flag Snag exposes and what each does.' },
  { to: 'ai-summarize', title: 'AI Summarize', desc: 'Setup, config and the transcript → article pipeline.' },
  { to: 'changelog', title: 'Changelog', desc: 'What changed, version by version.' },
];

export default function Home() {
  const heroShot = useBaseUrl('/img/snag-ai-setup.png');
  return (
    <Layout
      title="Snag — self-hosted web UI for yt-dlp"
      description="Snag is a minimal, self-hosted web UI for yt-dlp: grab videos, playlists, channels and audio from your browser — plus an AI Summarize pipeline.">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroScrim} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <div className={styles.badge}>Self-hosted · v1.3.0</div>
              <h1 className={styles.heroTitle}>
                Grab videos, playlists &amp; audio <span className={styles.accent}>from your browser.</span>
              </h1>
              <p className={styles.heroSub}>
                Snag is a minimal, self-hosted web UI for <strong>yt-dlp</strong> — paste a link,
                pick your options, and watch it download with live progress. Plus an AI
                Summarize tool that turns any video into a clean Markdown article.
              </p>
              <div className={styles.ctaRow}>
                <Link className="button button--lg" style={{ background: '#3ddc84', color: '#07140c', fontWeight: 800, border: 'none' }} to="introduction">
                  Start the documentation
                </Link>
                <Link
                  className="button button--lg"
                  style={{ background: 'transparent', color: '#e8ecf1', border: '1px solid #2f3a45' }}
                  href="https://github.com/drbiobit/snag">
                  View on GitHub
                </Link>
              </div>
              <div className={styles.pills}>
                <span className={styles.pill}>Python 3.10+</span>
                <span className={styles.pill}>Docker</span>
                <span className={styles.pill}>No build step</span>
                <span className={styles.pill}>MIT</span>
              </div>
            </div>
            <div className={styles.heroShot}>
              <div className={styles.frame}>
                <div className={styles.shine} />
                <div className={styles.frameBar}>
                  <span className={`${styles.dot} ${styles.r}`} />
                  <span className={`${styles.dot} ${styles.y}`} />
                  <span className={`${styles.dot} ${styles.g}`} />
                  <span className={styles.urlBar}><b>localhost</b>:8000/summarize</span>
                </div>
                <img className={styles.frameShot} src={heroShot} alt="Snag AI Summarize — configure your endpoint" />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <div className={styles.eyebrow}>What it does</div>
            <h2 className={styles.sectionTitle}>Everything yt-dlp can do, in a browser</h2>
            <p className={styles.sectionDesc}>
              No CLI, no build step, no third-party accounts. It runs on your own box — your
              downloads never leave your network.
            </p>
            <div className={styles.features}>
              {features.map((f, i) => (
                <div key={f.title} className={i < 2 ? `${styles.feature} ${styles.featureLarge}` : styles.feature}>
                  <div className={styles.featIcon}>{f.icon}</div>
                  <h3 className={styles.featTitle}>{f.title}</h3>
                  <p className={styles.featDesc}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className={styles.sectionInner}>
            <div className={styles.eyebrow}>Quick start</div>
            <h2 className={styles.sectionTitle}>Up in 30 seconds</h2>
            <p className={styles.sectionDesc}>
              Pull the prebuilt image, run it, and open your browser. Account setup happens
              on first visit — nothing to configure up front.
            </p>
            <div className={styles.quickSteps}>
              <div className={styles.quickStep}>
                <span className={styles.stepNum}>1</span>
                <div>
                  <h4>Pull the image</h4>
                  <p>Grab the prebuilt container from GHCR.</p>
                </div>
              </div>
              <div className={styles.quickStep}>
                <span className={styles.stepNum}>2</span>
                <div>
                  <h4>Run it</h4>
                  <p>One command, port 8000, volume for downloads.</p>
                </div>
              </div>
              <div className={styles.quickStep}>
                <span className={styles.stepNum}>3</span>
                <div>
                  <h4>Open your browser</h4>
                  <p>Visit <code>localhost:8000</code> — set up your account on first visit.</p>
                </div>
              </div>
            </div>
            <div className={styles.codeBlock}>
              <div className={styles.codeBar}>
                <span className={`${styles.dot} ${styles.r}`} />
                <span className={`${styles.dot} ${styles.y}`} />
                <span className={`${styles.dot} ${styles.g}`} />
                <span className={styles.codeBarLabel}>terminal</span>
              </div>
              <pre className={styles.codeBody}><code>{'docker pull ghcr.io/drbiobit/snag:latest\n\ndocker run -d --name snag \\\n  -p 8000:8000 \\\n  -v ./downloads:/data \\\n  ghcr.io/drbiobit/snag:latest'}</code></pre>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <div className={styles.eyebrow}>Documentation</div>
            <h2 className={styles.sectionTitle}>Guides &amp; references</h2>
            <p className={styles.sectionDesc}>
              Everything you need — from first deploy to reading the source.
            </p>
            <div className={styles.docsGrid}>
              {docs.map((d) => (
                <Link key={d.to} to={d.to} className={styles.docsCard}>
                  <div className={styles.docsCardTitle}>{d.title}</div>
                  <div className={styles.docsCardDesc}>{d.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
