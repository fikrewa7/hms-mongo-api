# Hotel Reservations API

REST API for a hotel reservation system built with Node.js, Express, and MongoDB Atlas.

## Tech Stack

- Node.js
- Express
- MongoDB Atlas
- CORS, dotenv

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in your MongoDB URI
3. Run the server: `npm start`

## Endpoints

- GET /api/reservations
- GET /api/reservations/guest/:clientNumber
- GET /api/reservations/unit
- GET /api/reservations/average
- GET /api/reservations/largest
- GET /api/reservations/:reservationNumber
- GET /api/services/total
- GET /api/statistics
- POST /api/reservations
- PUT /api/reservations/:reservationNumber
- DELETE /api/reservations/:reservationNumber
