// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-137, Q10 = 1; register F224): what a schedule was MADE FOR.
//
// Four TAGS - variety, soilType, region, climate - each optional, each a short code from the ONE list file ../schedule-made-for.json (the server embeds
// the same file: ShramSafal.Application.MadeForLists). Tags only (Q10): the server never refuses a plot a schedule because of them; the phone (part b)
// may show a soft line. The crop stays the schedule's required field; the days stay derived from its stages.
//   - soilType / climate / region: the list's codes (ASCII). The Marathi / English labels in the file are DATA for the phone, never codes.
//   - variety: the contract cannot know the crop, so it accepts the UNION of every crop's list (and `_other`: Local, Hybrid); the SERVER checks the
//     variety per crop code (a Grapes schedule may not say Local; a Sugarcane one may) and answers ShramSafal.ScheduleMadeFor (400 / failed, permanent).
// The lists are PROPOSED, unchecked by an agronomist (F224).
import { z } from 'zod';
import lists from '../schedule-made-for.json';

type Codes = [string, ...string[]];

export const ZSoilType = z.enum(lists.soilType as Codes);
export const ZClimate = z.enum(lists.climate as Codes);
export const ZRegion = z.enum(lists.region as Codes);
export const ZVariety = z.enum([...new Set(Object.values(lists.variety).flat())] as Codes);
