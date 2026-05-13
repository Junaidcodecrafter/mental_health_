# Deployment Strategy: MindfulAI Companion

## 1. Frontend: Vite (React) -> Vercel
1. **Push to GitHub**: Initialize a Git repository and push your project to GitHub.
2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com) and import your repository.
   - **Framework Preset**: Select "Other" or "Vite".
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Environment Variables**: Add `GEMINI_API_KEY` and all keys from `firebase-applet-config.json` (translated to `VITE_` prefix if used in client). Note: In this project, the config is imported directly from the JSON file, ensure it's committed or recreate it as secrets.

## 2. Backend: Express -> Render
*Note: This project uses a unified Full-Stack "Vite + Express" architecture.*
1. **Connect to Render**:
   - Go to [render.com](https://render.com) and create a new "Web Service".
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node server.ts` (Ensure `server.ts` is compiled to JS or use `tsx` if supported in the environment).
   - **Environment Variables**:
     - `NODE_ENV=production`
     - `GEMINI_API_KEY=your_key`

## 3. Database: Firebase -> Firestore
- The project is already integrated with Firebase.
- Ensure your `firestore.rules` are deployed using the Firebase CLI:
  `firebase deploy --only firestore:rules`

## 4. Ethical Safeguards
- The self-harm intercept is hardcoded in both `server.ts` (sentiment analysis) and `App.tsx` (UI trigger).
- Always verify the crisis hotline numbers are correct for your target demographic.
