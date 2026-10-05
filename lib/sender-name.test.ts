import { describe, expect, it } from "vitest";
import {
  CREDENTIALS,
  CREDENTIAL_CHOICES,
  MAX_DISPLAY_NAME,
  MAX_OTHER_CREDENTIAL,
  addsDoctor,
  defaultSenderName,
  effectiveSenderName,
  parseNameChoice,
  readSenderName,
  sentByLine,
  type CredentialPick,
  type NameChoice,
} from "./sender-name";

/** The name rules in lib/sender-name.ts, with plain values. No database, no Clerk. */

describe("defaultSenderName", () => {
  it("is 'Dr. First Last' from the two names", () => {
    expect(defaultSenderName("Jane", "Smith")).toBe("Dr. Jane Smith");
    expect(defaultSenderName("  Jane ", " Smith  ")).toBe("Dr. Jane Smith");
  });

  it("uses whichever name there is when one is missing", () => {
    expect(defaultSenderName("Jane", null)).toBe("Dr. Jane");
    expect(defaultSenderName(undefined, "Smith")).toBe("Dr. Smith");
  });

  it("is null when Clerk has no name at all, never an email or an empty 'Dr.'", () => {
    expect(defaultSenderName(null, null)).toBeNull();
    expect(defaultSenderName("", "   ")).toBeNull();
  });

  it("does not add a second 'Dr.'", () => {
    expect(defaultSenderName("Dr. Jane", "Smith")).toBe("Dr. Jane Smith");
    expect(defaultSenderName("dr", "Smith")).toBe("dr Smith");
    // A name that only starts with the letters is still a name.
    expect(defaultSenderName("Drew", "Barry")).toBe("Dr. Drew Barry");
  });

  it("is never longer than the limit", () => {
    expect(defaultSenderName("A".repeat(60), "B".repeat(60))!.length).toBe(MAX_DISPLAY_NAME);
  });
});

/** A choice as the editor sends it. */
const pick = (name: string, credential: string, other = "") => ({ name, credential, other });
const words = (value: unknown) => {
  const result = parseNameChoice(value);
  return result.ok ? result.words : `refused: ${result.message}`;
};

describe("parseNameChoice and buildSenderName: a name and a credential make the words", () => {
  it("puts Dr. in front for MD, DO and DPM, and the credential after the name", () => {
    expect(words(pick("Jane Smith", "MD"))).toBe("Dr. Jane Smith, MD");
    expect(words(pick("Jane Smith", "DO"))).toBe("Dr. Jane Smith, DO");
    expect(words(pick("Jane Smith", "DPM"))).toBe("Dr. Jane Smith, DPM");
    expect(["MD", "DO", "DPM"].every((credential) => addsDoctor(credential as CredentialPick))).toBe(true);
  });

  it("adds no Dr. for PA-C and NP", () => {
    expect(words(pick("Jane Smith", "PA-C"))).toBe("Jane Smith, PA-C");
    expect(words(pick("Jane Smith", "NP"))).toBe("Jane Smith, NP");
    expect(["PA-C", "NP", "other", "none", ""].some((credential) => addsDoctor(credential as CredentialPick))).toBe(false);
  });

  it("puts a typed Other credential after the name, with no Dr.", () => {
    expect(words(pick("Jane Smith", "other", "LAc"))).toBe("Jane Smith, LAc");
    expect(words(pick("Jane Smith", "other", "  APRN-CNP "))).toBe("Jane Smith, APRN-CNP");
  });

  it("shows just the name for None, with no Dr. added", () => {
    expect(words(pick("Jane Smith", "none"))).toBe("Jane Smith");
    // A typed Other credential is ignored unless Other is the choice.
    expect(words(pick("Jane Smith", "none", "LAc"))).toBe("Jane Smith");
  });

  it("offers every credential in the list, nothing picked in advance", () => {
    expect(CREDENTIAL_CHOICES.map((choice) => choice.value)).toEqual(["MD", "DO", "DPM", "PA-C", "NP", "other", "none"]);
    expect(CREDENTIALS).toEqual(["MD", "DO", "DPM", "PA-C", "NP"]);
  });

  it("tidies spaces, line breaks and control characters, and keeps names of any language", () => {
    expect(words(pick("  Jane \n\t Smith\u0007 ", "DO"))).toBe("Dr. Jane Smith, DO");
    expect(words(pick("Seán O'Brien-Núñez", "NP"))).toBe("Seán O'Brien-Núñez, NP");
    expect(words(pick("Nguyễn Văn An", "MD"))).toBe("Dr. Nguyễn Văn An, MD");
    // A name that only starts with the letters is still a name.
    expect(words(pick("Drew Barry", "MD"))).toBe("Dr. Drew Barry, MD");
  });

  it("never lets Dr. or the credential be typed twice: no Dr. and no comma in the name box", () => {
    for (const name of ["Dr. Jane Smith", "dr Jane Smith", "Dr.Jane Smith", "DR"]) {
      expect(words(pick(name, "MD")), name).toContain('Leave "Dr." out');
    }
    expect(words(pick("Jane Smith, PA-C", "none"))).toContain("no comma");
    expect(words(pick("Jane Smith, MD", "MD"))).toContain("no comma");
  });

  it("refuses an empty name, markup, links, digits and symbols, with a plain sentence", () => {
    expect(words(pick("", "MD"))).toContain("Type the name");
    expect(words(pick("   ", "MD"))).toContain("Type the name");
    for (const bad of ["<b>Jane</b>", "Jane Smith https://example.com", "Jane & Co", "Jane 123", "@jane", "-Jane"]) {
      expect(words(pick(bad, "NP")), bad).toContain("letters");
    }
  });

  it("refuses a credential that is not in the list, or none chosen", () => {
    for (const credential of ["", "md", "PhD", "Dr", "<b>"]) expect(words(pick("Jane Smith", credential)), credential).toBe("refused: Choose a credential, or None.");
    expect(words({ name: "Jane Smith" })).toBe("refused: Choose a credential, or None.");
  });

  it("checks an Other credential: letters and hyphens, a few characters, and not one already in the list", () => {
    expect(words(pick("Jane Smith", "other", ""))).toContain("Type the credential");
    for (const bad of ["Ph.D.", "LAc 2", "-LAc", "DNP, APRN", "<b>"]) expect(words(pick("Jane Smith", "other", bad)), bad).toContain("letters and hyphens");
    expect(words(pick("Jane Smith", "other", "A".repeat(MAX_OTHER_CREDENTIAL)))).toBe(`Jane Smith, ${"A".repeat(MAX_OTHER_CREDENTIAL)}`);
    expect(words(pick("Jane Smith", "other", "A".repeat(MAX_OTHER_CREDENTIAL + 1)))).toContain(`${MAX_OTHER_CREDENTIAL} characters`);
    expect(words(pick("Jane Smith", "other", "md"))).toBe("refused: MD is in the list. Choose it there.");
    expect(words(pick("Jane Smith", "other", "Pa-c"))).toBe("refused: PA-C is in the list. Choose it there.");
  });

  it("refuses finished words over the limit, and accepts them at it", () => {
    // "Dr. " + name + ", MD" is the name plus 8 characters.
    expect(words(pick("A".repeat(MAX_DISPLAY_NAME - 8), "MD"))).toHaveLength(MAX_DISPLAY_NAME);
    expect(words(pick("A".repeat(MAX_DISPLAY_NAME - 7), "MD"))).toContain(`${MAX_DISPLAY_NAME} characters`);
  });

  it("refuses something that is not a name and a credential", () => {
    for (const bad of [null, undefined, 42, "Dr. Jane Smith, MD", ["Jane", "MD"]]) expect(parseNameChoice(bad).ok).toBe(false);
    expect(words({ name: 42, credential: "MD" })).toContain("Type the name");
  });
});

describe("readSenderName: stored words back into the choice that made them", () => {
  const every: NameChoice[] = [
    { name: "Jane Smith", credential: "MD", other: "" },
    { name: "Jane Smith", credential: "DO", other: "" },
    { name: "Jane Smith", credential: "DPM", other: "" },
    { name: "Jane Smith", credential: "PA-C", other: "" },
    { name: "Jane Smith", credential: "NP", other: "" },
    { name: "Jane Smith", credential: "other", other: "LAc" },
    { name: "Jane Smith", credential: "other", other: "Jr" },
    { name: "Jane Smith", credential: "none", other: "" },
    { name: "Seán O'Brien-Núñez", credential: "DO", other: "" },
    { name: "Drew Barry", credential: "none", other: "" },
    { name: "Mary-Kate (Katie) Lee", credential: "other", other: "APRN-CNP" },
  ];

  it("building then reading back gives the same choice, for every kind", () => {
    for (const choice of every) {
      const built = parseNameChoice(choice);
      expect(built.ok, JSON.stringify(choice)).toBe(true);
      if (built.ok) expect(readSenderName(built.words), built.words).toEqual({ choice, exact: true });
    }
  });

  it("reads the Dr. First Last default as the name with the credential still to choose", () => {
    expect(readSenderName("Dr. Jane Smith")).toEqual({ choice: { name: "Jane Smith", credential: "", other: "" }, exact: false });
  });

  it("reads nothing as an empty editor", () => {
    expect(readSenderName(null)).toEqual({ choice: { name: "", credential: "", other: "" }, exact: false });
    expect(readSenderName("  ")).toEqual({ choice: { name: "", credential: "", other: "" }, exact: false });
  });

  it("gives its best reading of a name typed before the list existed, and says it is not exact", () => {
    // Dr. with a credential that does not add it.
    expect(readSenderName("Dr. Jane Smith, PA-C")).toEqual({ choice: { name: "Jane Smith", credential: "PA-C", other: "" }, exact: false });
    // A doctor's credential without the Dr.
    expect(readSenderName("Jane Smith, MD")).toEqual({ choice: { name: "Jane Smith", credential: "MD", other: "" }, exact: false });
    // Something Other cannot hold is offered as Other, and refused with the reason if saved as it is.
    expect(readSenderName("Jane Smith, Ph.D.")).toEqual({ choice: { name: "Jane Smith", credential: "other", other: "Ph.D." }, exact: false });
    // Old free text with brackets is just a name, with no credential.
    expect(readSenderName("Seán O'Brien (NP)")).toEqual({ choice: { name: "Seán O'Brien (NP)", credential: "none", other: "" }, exact: true });
  });
});

describe("effectiveSenderName and sentByLine", () => {
  it("prefers the typed name, then the default, then nothing", () => {
    expect(effectiveSenderName("Jane Smith, PA-C", "Dr. Jane Smith")).toBe("Jane Smith, PA-C");
    expect(sentByLine("Dr. Jane Smith, DO", "Summit Orthopedics")).toBe("Sent by Dr. Jane Smith, DO, Summit Orthopedics");
    expect(effectiveSenderName(null, "Dr. Jane Smith")).toBe("Dr. Jane Smith");
    expect(effectiveSenderName("", "Dr. Jane Smith")).toBe("Dr. Jane Smith");
    expect(effectiveSenderName(null, null)).toBeNull();
  });

  it("says who sent it, or only the clinic for a link with no name", () => {
    expect(sentByLine("Dr. Jane Smith", "Summit Orthopedics")).toBe("Sent by Dr. Jane Smith, Summit Orthopedics");
    expect(sentByLine(null, "Summit Orthopedics")).toBe("From Summit Orthopedics");
    expect(sentByLine("", "Summit Orthopedics")).toBe("From Summit Orthopedics");
  });
});
