# Chrome Web Store Submission Pack

Updated: 2026-05-24

## Current Upload Package

- Extension: 灵感爆爆爆
- Version: 2.0.19
- Upload ZIP: `/Users/moglenny/proma/选题插件-打磨中/linggan-boom/releases/linggan-boom-v2.0.19.zip`
- SHA256: `3e1304635807e6d43e205a58591c5560b598d6d9c07db807a3da0d52a88e625b`
- Size: `394011` bytes

The package has been checked with:

```bash
npm run build
npm run release:verify -- --version 2.0.19 --zip releases/linggan-boom-v2.0.19.zip
node --test
```

## Recommended Publishing Choice

Use **Unlisted** visibility for the first submission.

Reason: your goal is team distribution and automatic update, not public search traffic. Unlisted gives colleagues a Chrome Web Store link, Chrome handles updates automatically, and the extension will not appear in general store search. If your company has a Google Workspace domain and you want strict domain-only access, use **Private** instead.

## Dashboard Steps

1. Open Chrome Web Store Developer Dashboard.
2. Click **Add new item**.
3. Upload `releases/linggan-boom-v2.0.19.zip`.
4. Fill **Store listing** using `store-listing.md`.
5. Upload images from `assets/`.
6. Fill **Privacy** using `privacy-and-permissions.md`.
7. Paste reviewer instructions from `reviewer-notes.md`.
8. Set **Distribution** to Unlisted, Free, all regions unless you want to restrict regions.
9. Submit for review.

## Files Prepared

- `store-listing.md`: store name, short summary, long description, category, language.
- `privacy-and-permissions.md`: single purpose, data disclosure, permission explanations.
- `privacy-policy.md`: public privacy policy text. A matching content workbench page has been added at `/privacy/linggan-boom-extension`; after deploying the workbench, use `https://lingganboom.fun/privacy/linggan-boom-extension`.
- `reviewer-notes.md`: instructions for Google's reviewer.
- `assets/icon-128.png`: store icon.
- `assets/screenshot-dashboard-notes-1280x800.png`: required screenshot.
- `assets/screenshot-dashboard-comments-1280x800.png`: optional screenshot.
- `assets/screenshot-dashboard-authors-1280x800.png`: optional screenshot.
- `assets/promo-small-440x280.png`: small promo tile.

## Remaining Owner Action

Google requires actions that must be done from the registered developer account:

- Upload and submit in the Developer Dashboard.
- Paste the public privacy policy URL: `https://lingganboom.fun/privacy/linggan-boom-extension`.

## Current Review Risk Notes

- The extension requests powerful permissions because it works inside 小红书 and 抖音 pages, downloads media, manages task tabs, reads platform cookies, and receives workbench push wakeups. These are explainable, but the privacy and permission fields must be filled carefully.
- The package includes `http://localhost/*` because the plugin can connect to a local content workbench during development or internal operation. Chrome treats this pattern as matching any localhost port. If the store reviewer questions this, either explain it as an internal/local workbench mode or publish a store-only build without the localhost host permission.
- The extension uses silent Web Push to wake the background worker when a workbench task or task-control event is available. This is why the `notifications` permission is present.
