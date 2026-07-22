import { describe, expect, it } from "vitest";
import { findNearestPub, isValidPubId } from "../src/pubs";

describe("findNearestPub", () => {
  it("selects the nearest valid pub and preserves its stable OSM identity", () => {
    const pub = findNearestPub(
      [
        {
          type: "way",
          id: 22,
          center: { lat: 51.51, lon: -0.12 },
          tags: { amenity: "pub", name: "The Far Pint" },
        },
        {
          type: "node",
          id: 11,
          lat: 51.5005,
          lon: -0.1005,
          tags: {
            amenity: "bar",
            name: "The Local",
            "addr:housenumber": "7",
            "addr:street": "Hop Lane",
          },
        },
      ],
      51.5,
      -0.1,
    );

    expect(pub).toMatchObject({
      id: "osm:node:11",
      name: "The Local",
      category: "bar",
      address: "7 Hop Lane",
      source: "openstreetmap",
    });
    expect(pub?.distanceMeters).toBeLessThan(100);
  });

  it("ignores non-pub amenities and elements without coordinates", () => {
    expect(
      findNearestPub(
        [
          { type: "node", id: 1, lat: 1, lon: 1, tags: { amenity: "restaurant" } },
          { type: "way", id: 2, tags: { amenity: "pub" } },
        ],
        1,
        1,
      ),
    ).toBeNull();
  });
});

describe("isValidPubId", () => {
  it("accepts server-issued IDs and rejects arbitrary upload metadata", () => {
    expect(isValidPubId("osm:relation:12345")).toBe(true);
    expect(isValidPubId("estimated:51.50:-0.10")).toBe(true);
    expect(isValidPubId("some-user-controlled-cluster")).toBe(false);
  });
});
