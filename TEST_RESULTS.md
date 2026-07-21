# Test results

## Flight screenshot extraction

Tested against an Emirates itinerary screenshot showing:

- ARN → DXB: EK 158, 3:35 PM–12:10 AM, 6h 35m
- 2h 10m Dubai layover
- DXB → SIN: EK 348, 2:20 AM–2:05 PM, 7h 45m

The complete `FlightItinerary` JSON Schema, including nested segment objects, was accepted by Codex strict structured output. The service returned the two flights as ordered outbound segments with ISO datetimes.

## Measured usage

| Metric | Result |
| --- | ---: |
| Response time | ~10 seconds |
| Codex input tokens | 14,363 |
| Codex output tokens | 200 |
| Total reported tokens | 14,563 |

These values come from Codex's `turn.completed` JSONL event. Earlier character-count estimates (such as 150 tokens) excluded image and Codex context tokens and were incorrect.

## Notes

- The screenshot did not visibly show a price. The model may still fabricate a plausible value, so the client prompt explicitly instructs it to use `null` for values not visible in the image.
- A structured schema guarantees shape, not factual accuracy. Consumers should validate data before using it for booking or payment decisions.
