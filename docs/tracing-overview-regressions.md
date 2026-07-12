# Tracing overview follow-up issues

Scope: `/genai/tracing` Mintlify-style Docusaurus page. Pixel-perfect matching is no longer the goal; prioritize fixing regressions without disrupting the current visual direction.

| Issue                                                                 | Status        | Notes                                                                                               |
| --------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| Sidebar wheel scroll should scroll the sidebar, not the main document | Fixed locally | Sidebar now owns vertical overflow and contains wheel chaining.                                     |
| Top nav and tabs bottom borders are too strong                        | Fixed locally | Borders use lower-opacity neutral colors; active indicators are thinner/subtler.                    |
| Remove unsupported desktop/theme icon from top right                  | Fixed locally | Unsupported theme/desktop control removed from the custom navbar.                                   |
| Hero video is not working                                             | Fixed locally | Video controls/autoplay/loop are restored; CSS no longer hides controls.                            |
| Collapsed sidenav sections do not expand                              | Fixed locally | Guide groups are React disclosures with child links.                                                |
| Search bar is not functioning                                         | Fixed locally | Custom navbar now renders the existing Docusaurus/Algolia `SearchBar`.                              |
| Right nav/table of contents is missing                                | Fixed locally | Docusaurus desktop TOC is restored and styled as a sticky right rail.                               |
| Text does not wrap responsively to the viewport width                 | Fixed locally | Fixed 801px content/media widths and text scale transforms are replaced with fluid max-width rules. |
| Right panel should match Mintlify TOC UI                              | Fixed locally | Right rail now uses Mintlify spacing, ordering, nested item, active color, and no left border.      |
| Expanded left nav should match Mintlify guide disclosure style        | Fixed locally | Expanded guide rows now match Mintlify sizing, casing, active pill color, padding, and radius.      |
