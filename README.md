# Chat API with AI Integration

A full-stack Node.js application with real-time chat functionality, subscription management, and AI-powered features using Google's Gemini API.

## 🚀 Features

- **User Authentication** - JWT-based secure authentication
- **Subscription Management** - Stripe integration for payment processing
- **AI-Powered Chat** - Google Gemini API integration for intelligent responses
- **Background Job Processing** - Queue system for asynchronous tasks


### Core Components

- **Express.js Server**: RESTful API with TypeScript
- **Authentication System**: JWT-based user authentication
- **Payment Processing**: Stripe integration for subscription management
- **AI Integration**: Google Gemini API for enhanced chat features
- **Background Processing**: Redis-based queue system for asynchronous tasks
- **Webhook Handling**: Secure webhook endpoints for payment events

## Tech Stack

- **Backend**: Node.js, Express.js, TypeScript
- **Database**: SupaBase
- **Authentication**: JWT (JSON Web Tokens)
- **Payment**: Stripe API
- **AI**: Google Gemini API
- **Queue**: Redis with Bull Queue

## ⚙️ Environment Setup

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DATABASE_URL=mongodb://localhost:27017/your-db-name
# OR for PostgreSQL:
# DATABASE_URL=postgresql://username:password@localhost:5432/your-db-name

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_signing_secret

# Google Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-pro

# Redis Configuration (for Queue System)
REDIS_URL=redis://localhost:6379

# CORS Configuration
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

## 🚀 Installation & Setup

### 1. Clone the Repository
```bash
git clone 
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit the environment variables
nano .env
```

#### Production Mode
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000`

### Rate Limiting & Optimization
- API calls queued to respect rate limits
- Subscription-based feature access control

## 🧪 Testing with Postman

### Postman Collection
[Access the complete API collection](https://api333-5543.postman.co/workspace/api-Workspace~3799ad80-01e3-4f9f-8a5e-fcbcd84368b6/collection/24813690-e54cdeb7-72fb-4bbd-b2ae-14df70aa48f4?action=share&creator=24813690)
