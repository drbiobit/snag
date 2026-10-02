import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';

// Snag documentation site (Docusaurus).
// Built by .github/workflows/pages.yml and published to
// https://drbiobit.github.io/snag/
const config: Config = {
  title: 'Snag Docs',
  tagline:
    'Self-hosted web UI for yt-dlp — grab videos, playlists, channels & audio from your browser.',
  favicon: 'img/favicon.svg',

  // The URL of your Docusaurus site without trailing slash.
  url: 'https://drbiobit.github.io',
  // Used as __dirname equivalent
  baseUrl: '/snag/',

  // Set the production url of your site here
  organizationName: 'drbiobit',
  projectName: 'snag',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Even if you don't use internalization, you can use this field for i18n:
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Remove this if your site has no docs.
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],

  themeConfig: {
    image: 'img/snag-social.png',
    navbar: {
      title: 'Snag',
      logo: {
        alt: 'Snag logo',
        src: 'img/logo.svg',
      },
      items: [
        {to: '/', label: 'Docs', position: 'left'},
        {
          href: 'https://github.com/drbiobit/snag',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://github.com/drbiobit/snag/releases',
          label: 'Releases',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      copyright: `Copyright © ${new Date().getFullYear()} Snag. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.github,
    },
    // Local (offline) search - no external service, works on the static site.
    // Provided by the @easyops-cn/docusaurus-search-local plugin (see below).
    // @ts-expect-error - shape is defined by the plugin, not the core types
    search: {
      type: 'local',
    },
  } as any,

  // Offline, client-side search. No external API - the index is built into
  // the static site at build time.
  themes: ['@easyops-cn/docusaurus-search-local'],

};

export default config;
