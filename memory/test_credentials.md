# Test Credentials — AdvScribbl

## Active test users
### Primary
- **Username**: `alex_tester` / **Password**: `secret123`
- **Name**: Alex Test / **Email**: alex@test.dev

### Secondary (for multiplayer testing)
- **Username**: `player2` / **Password**: `secret123`
- **Name**: Player Two / **Email**: p2@test.dev

If the database has been reset, sign up via `POST /api/auth/signup`.

## Razorpay (LIVE TEST mode)
- `RAZORPAY_KEY_ID=rzp_test_T6fWxjbW3UGGAU`
- `RAZORPAY_KEY_SECRET=NuAYGvaEe3ztKDUGQk7hg375`
- `PAYMENT_MOCK_MODE=0`  (real Razorpay API is called)
- Use Razorpay test card `4111 1111 1111 1111` with any future expiry + any 3-digit CVV
- Or test UPI: `success@razorpay`

## JWT
- `JWT_SECRET` in `/app/backend/.env`
- Tokens expire in 30 days, sent as `Authorization: Bearer <token>` header

## Multiplayer testing
- Open two browser tabs (or one regular + one incognito)
- Sign in as `alex_tester` in tab 1, click **Create Private Room**, copy invite link
- Open invite link in tab 2, sign in as `player2`
- Back to tab 1, click **Start!** (minimum 2 players required)
