import { describe, expect, it } from "vitest";
import { parseMapViewQuery } from "@/lib/mapViewQuery";

describe("parseMapViewQuery", () => {
  it("returns null if lat or lng is missing", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lng=141.35"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams(""))).toBeNull();
  });

  it("returns null if lat or lng is an empty or whitespace string (Number('') === 0)", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=&lng=141.35"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng="))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=   &lng=141.35"))).toBeNull();
  });

  it("accepts the equator origin explicitly (lat=0&lng=0)", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=0&lng=0"))).toEqual({
      lat: 0,
      lng: 0,
      zoom: 13,
    });
  });

  it("returns lat, lng, and default zoom (13) when zoom is omitted", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35"))).toEqual({
      lat: 43.065,
      lng: 141.35,
      zoom: 13,
    });
  });

  it("respects zoom if within valid bounds (1..19)", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=9"))).toEqual({
      lat: 43.065,
      lng: 141.35,
      zoom: 9,
    });
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=19"))).toEqual({
      lat: 43.065,
      lng: 141.35,
      zoom: 19,
    });
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=1"))).toEqual({
      lat: 43.065,
      lng: 141.35,
      zoom: 1,
    });
  });

  it("returns null if zoom is out of bounds", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=0"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=20"))).toBeNull();
  });

  it("returns null if lat is out of bounds", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=91&lng=141.35"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=-91&lng=141.35"))).toBeNull();
  });

  it("returns null if lng is out of bounds", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=200"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=-200"))).toBeNull();
  });

  it("returns null for non-numeric values", () => {
    expect(parseMapViewQuery(new URLSearchParams("lat=abc&lng=141.35"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=xyz"))).toBeNull();
    expect(parseMapViewQuery(new URLSearchParams("lat=43.065&lng=141.35&zoom=abc"))).toBeNull();
  });
});
