# PRD — AdvScribbl

## Original problem statement
> Read every attached document and analyze the complete GitHub repository and the uploaded reference ZIP before making any changes. The attached prompt file and architecture document are the source of truth for this project. Follow every requirement specified in them. i missed these 4 lines in the EMERGENT_AI_PROMPTOOO — Keep the static illustrated background similar to Skribbl.io but made a new background. Place modern UI cards floating on top of the background. Use glassmorphism. Redesign every UI component while keeping the same layout philosophy.

## Iteration 2 (rebrand + polish)
> the website name is "AdvScribbl"; Razorpay live test keys provided (rzp_test_T6fWxjbW3UGGAU + secret); REMOVE AI BOT; remove the sticker selection; USE the uploaded dark navy doodle background; the front UI should look like skribbl.io with one colour per letter; use normal emoji-style colored character heads for profiles; check all buttons; all to spec.

## Architecture (locked choices)
- **Backend**: Node.js + Express + Socket.io + SQLite (`/app/backend`)
- **Frontend**: vanilla HTML/CSS/JS served as static files via Express (`/app/frontend`)
- **Auth**: Custom local JWT (Name, Username, Email, Password) + bcrypt 10 rounds
- **Payments**: Razorpay LIVE test mode (real keys: `rzp_test_T6fWxjbW3UGGAU`) — ₹25 lifetime premium + 6 months ad-free with HMAC SHA256 verification
- **Real-time**: Socket.io at path `/api/socket.io/` with JWT handshake auth
- **State machine**: G/K/F/V/j/Z/X/J as per architecture spec, multiplexed via `data` events with packet IDs

## Visual identity
- Brand: **AdvScribbl** with multi-colored letter-per-letter logo (red→orange→yellow→green→cyan→blue→purple→magenta→pink→orange)
- Avatars: 8 classic skribbl-style colored character heads (red/orange/yellow/green/cyan/blue/purple/pink) with eye+mouth face features rendered via CSS
- Background: User-uploaded dark navy doodle PNG (`/app/frontend/img/doodle-bg.png`) tiled, fixed, with subtle gradient overlay
- Glassmorphism cards floating on top (22px backdrop-blur, 60-80% opacity layers)
- Skribbl-style fat green "Play!" + blue "Create Private Room" buttons with chunky 3D shadows

## Implemented features
- [x] Multi-colored AdvScribbl rainbow letter logo
- [x] Static doodle background (user-uploaded)
- [x] 8 classic colored character head avatars with face features
- [x] AI BOT functionality REMOVED (both UI button and backend packet handlers)
- [x] Sticker/emoji avatar selection REPLACED with colored character heads
- [x] Razorpay LIVE TEST mode (PAYMENT_MOCK_MODE=0, real keys configured)
- [x] All home buttons functional: Play!, Create Private Room, Join (invite code), Unlock Premium, Logout, Avatar arrows + Randomize
- [x] Game buttons functional: Start!, Copy Invite Link, Leave, all 6 drawing tools (Pencil/Bucket/Line/Rect/Circle/Eraser), Undo, Clear, Premium Toggle, Color swatches (26 standard + 26 premium), Brush sizes (4 sizes), Chat send
- [x] Multiplayer verified end-to-end with 2 browser tabs — drawer sees word, guesser sees masked underscores, timer ticks
- [x] All 9 languages working (English + 8 Romanized Indian)
- [x] Settings dropdowns (Language/Players/Drawtime/Rounds/Word choices/Hints) in private rooms
- [x] State transitions K→F→V→j→Z→X→J fully wired
- [x] Drawer-mute, close-guess hints, podium scoring
- [x] `/api/terms` + `/api/credits` static pages branded AdvScribbl

## Backlog / Future
- P1: Server-side rate limiting on `/api/auth/*`
- P1: Avatar customization beyond color (eyes/mouth variations)
- P2: Persistent leaderboard across games
- P2: Spectator mode
- P2: Mobile-optimized touch controls

## Next action items
- None blocking — MVP is functional, multiplayer verified, Razorpay live test orders create successfully
- When ready: switch Razorpay to live (production) keys + flip `PAYMENT_MOCK_MODE=0` stays the same
