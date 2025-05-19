# Event Reservation System - Design Document

## 1. Introduction

This document outlines the design for an Event Reservation System. The system provides a REST API to manage event seat reservations, allowing users to create events, view available seats, hold seats for a limited time, reserve held seats, and refresh their holds.

## 2. System Architecture

The system is built using the following technologies:

*   **Backend Framework**: NestJS (a Node.js framework for building efficient, scalable server-side applications)
*   **Data Storage & Caching**: Redis, accessed via `cache-manager` and `cache-manager-redis-store`. Redis is configured for persistence (`appendonly yes`) to ensure data is not lost on restart.
*   **Containerization**: Docker is used to manage the Redis instance (`docker-compose.yml`). The NestJS application can also be containerized for deployment.
*   **API Documentation**: Swagger (OpenAPI) is integrated for clear API documentation and testing.

## 3. API Endpoints

The API exposes the following endpoints, rooted at `/` (e.g., `/events`):

*   **`POST /events`**:
    *   **Description**: Creates a new event with a specified number of seats.
    *   **Request Body**: `CreateEventDto`
        *   `numberOfSeats` (number): The total number of seats for the event (10 to 1,000).
    *   **Response**:
        *   `201 Created`: If the event is created successfully.
        *   `400 Bad Request`: If input validation fails.
*   **`POST /events/{eventId}/seats/{seatId}/hold`**:
    *   **Description**: Allows a user to place a temporary hold on a specific seat for an event.
    *   **Path Parameters**:
        *   `eventId` (string, UUID format): The ID of the event.
        *   `seatId` (string): The ID of the seat.
    *   **Request Body**: `HoldSeatDto`
        *   `userId` (string, UUID format): The ID of the user placing the hold.
    *   **Response**:
        *   `201 Created`: `{ message: 'Seat held successfully', holdExpiresAt: Date }`
        *   `400 Bad Request`: If input validation fails or user exceeds hold limit.
        *   `404 Not Found`: If the event or seat is not found.
        *   `409 Conflict`: If the seat is not available or already held by another user.
*   **`POST /events/{eventId}/seats/{seatId}/reserve`**:
    *   **Description**: Allows a user to permanently reserve a seat they are currently holding.
    *   **Path Parameters**:
        *   `eventId` (string, UUID format): The ID of the event.
        *   `seatId` (string): The ID of the seat.
    *   **Request Body**: `ReserveSeatDto`
        *   `userId` (string, UUID format): The ID of the user reserving the seat.
    *   **Response**:
        *   `201 Created`: `{ message: 'Seat reserved successfully' }`
        *   `400 Bad Request`: If input validation fails, or seat not held by the user, or hold expired.
        *   `404 Not Found`: If the event or seat is not found.
        *   `409 Conflict`: If the seat is held by another user.
*   **`GET /events/{eventId}/seats/available`**:
    *   **Description**: Lists all seats for an event that are not currently reserved and whose holds (if any) have expired.
    *   **Path Parameters**:
        *   `eventId` (string, UUID format): The ID of the event.
    *   **Response**:
        *   `200 OK`: An array of `Seat` objects.
        *   `404 Not Found`: If the event is not found.
*   **`POST /events/{eventId}/seats/{seatId}/refresh-hold`**:
    *   **Description**: Allows a user to refresh (extend) the hold duration on a seat they are currently holding.
    *   **Path Parameters**:
        *   `eventId` (string, UUID format): The ID of the event.
        *   `seatId` (string): The ID of the seat.
    *   **Request Body**: `RefreshHoldDto`
        *   `userId` (string, UUID format): The ID of the user refreshing the hold.
    *   **Response**:
        *   `201 Created`: `{ message: 'Hold refreshed successfully', holdExpiresAt: Date }`
        *   `400 Bad Request`: If input validation fails, seat not held by the user, or hold already expired.
        *   `404 Not Found`: If the event or seat is not found.

## 4. Data Models

*   **`Event`**:
    *   `eventId` (string): A unique identifier for the event (e.g., UUID).
    *   `totalSeats` (number): The total number of seats in the event.
    *   `seats` (Array<`Seat`>): An array of seat objects associated with the event.
*   **`Seat`**:
    *   `seatId` (string): A unique identifier for the seat within the event (e.g., "seat-1", "seat-2").
    *   `status` (string): The current status of the seat. Can be one of:
        *   `'available'`: The seat is free.
        *   `'held'`: The seat is temporarily held by a user.
        *   `'reserved'`: The seat is permanently reserved.
    *   `userId` (string, optional): The UUID of the user who holds or has reserved the seat. Present if status is `'held'` or `'reserved'`.
    *   `holdExpiresAt` (number, optional): A timestamp (milliseconds since epoch) indicating when the hold on the seat expires. Present if status is `'held'`.

## 5. Core Logic and Features

*   **Event Creation**:
    *   Events are created with a specified number of seats, ranging from 10 to 1,000.
    *   Each seat is initialized with a status of `'available'`.
    *   Event data is stored in Redis using the key format `event:{eventId}`.
*   **Seat Holding**:
    *   A user can hold a seat if it's `'available'` or if an existing hold on it has expired.
    *   The duration of a hold is configurable via the `CACHE_TTL` environment variable (default: 60 seconds).
    *   A user is limited to a maximum number of held seats per event, configurable via `MAX_HELD_SEATS_PER_USER` (default: 5).
    *   When a seat is held, its status changes to `'held'`, and `userId` and `holdExpiresAt` are set.
*   **Seat Reservation**:
    *   A user can reserve a seat only if they are currently holding it and the hold has not expired.
    *   Upon reservation, the seat's status changes to `'reserved'`, and `holdExpiresAt` is removed.
*   **Listing Available Seats**:
    *   This endpoint returns seats that are either `'available'` or were `'held'` but their `holdExpiresAt` time is in the past.
*   **Refreshing Seat Holds**:
    *   A user can extend the duration of their hold on a seat, provided they are the current holder and the hold has not yet expired.
    *   The `holdExpiresAt` timestamp is updated to `Date.now() + holdDuration`.
*   **Data Persistence**:
    *   Event and seat data is stored in Redis.
    *   Redis is configured with `appendonly yes` to ensure data durability across restarts.
    *   Cache entries for events are set with a TTL of 0, meaning they don't expire automatically via `cache-manager`'s TTL but rely on Redis persistence.

## 6. Configuration

The application uses environment variables for configuration, managed via `@nestjs/config` and a `.env` file:

*   `REDIS_HOST`: Hostname of the Redis server (e.g., `localhost`).
*   `REDIS_PORT`: Port number for the Redis server (e.g., `6379`).
*   `CACHE_TTL`: Default duration for seat holds in seconds (e.g., `60`).
*   `MAX_HELD_SEATS_PER_USER`: Maximum number of seats a single user can hold per event (e.g., `5`).
*   `PORT`: The port on which the NestJS application will listen (e.g., `3000`).

Input validation is handled globally using `ValidationPipe` with `class-validator` and `class-transformer` decorators in DTOs.

## 7. Error Handling

*   The API uses standard HTTP status codes to indicate the outcome of requests.
*   NestJS's `HttpException` is used for request-specific errors (e.g., `404 Not Found`, `400 Bad Request`, `409 Conflict`).
*   Validation errors are automatically handled by `ValidationPipe`, returning `400 Bad Request` with details.

## 8. API Documentation

*   Swagger (OpenAPI) is integrated using `@nestjs/swagger`.
*   The Swagger UI is accessible at the `/api` endpoint when the application is running.
*   DTOs and controller methods will be annotated with Swagger decorators (`@ApiProperty`, `@ApiOperation`, `@ApiResponse`, etc.) to provide detailed documentation.

## 9. Future Considerations / Potential Improvements

*   **Persistance storage**: Using postgresql or MySql
*  Authentication and Authorization

