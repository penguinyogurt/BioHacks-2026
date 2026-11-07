# The riluzole delivery gap in Canada

Alex Chen takes riluzole 50 mg twice daily. He coughs on thin liquids on the
timed water swallow, and his right pinch strength is 3 kg. Riluzole is
manufactured in forms built precisely for that patient. He cannot get any of
them, because he lives in Hamilton, Ontario.

This is the `canada` rule and the `swallow` rule firing on the same molecule,
and it is the one result in this project that needed no model at all.

## What the Health Canada Drug Product Database contains

Three riluzole products. All three are 50 mg tablets that must be swallowed
whole.

| Brand | DIN | Company | Form | Status |
|---|---|---|---|---|
| Rilutek | 02242763 | Sanofi-Aventis Canada | Tablet, 50 mg, oral | Marketed since 2000-10-26 |
| Apo-Riluzole | 02352583 | Apotex | Tablet, 50 mg, oral | Marketed (dormant 2022-02-05, re-marketed 2022-09-23) |
| Mylan-Riluzole | 02390299 | Mylan Pharmaceuticals ULC | Tablet, 50 mg, oral | Marketed since 2012-10-23 |

There is no riluzole oral film, orally disintegrating tablet, oral suspension,
oral solution or any other easy-swallow riluzole formulation authorized in
Canada.

That is not merely a statement about what is currently on pharmacy shelves. All
four official DPD extracts were downloaded and searched — marketed,
approved-but-not-yet-marketed, dormant, and cancelled, updated 2026-11-02,
38,695 drug records between them. A case-insensitive search for `riluzole`,
`exservan`, `teglutik` and `tiglutik` returns zero hits in the approved, dormant
and cancelled archives. **Exservan and Teglutik have never held a Canadian DIN
in any status.**

## What exists elsewhere

**Riluzole oral suspension — currently marketed, not in Canada.** Tiglutik
(NDA 209080, FDA-approved 2018-09-05, Italfarmaco) is prescription-marketed in
the United States. The same product is authorized across Europe as Teglutik,
nationally rather than centrally — Italy 2013, France 2013-11-19, mutual
recognition number IT/H/0308/001. This is the live comparator: a thickened
riluzole suspension a dysphagic patient can take, on the market in the US and
the EU, absent in Canada.

**Riluzole oral film — built, then withdrawn.** Exservan (NDA 212640, Aquestive
Therapeutics) was FDA-approved 2019-11-22 as a 50 mg film placed on top of the
tongue. Its label instructs `Do not administer with liquids`. Mitsubishi Tanabe
Pharma America discontinued it effective 2024-09-30, and the FDA formally
withdrew approval of NDA 212640 on 2025-02-14 (90 FR 3877). It no longer exists
anywhere in North America.

So the gap has two halves, and the second one is worse than the first: the
easiest formulation for a patient like Alex was developed, approved, and then
taken off the market for commercial reasons, while the suspension that remains
available in two other jurisdictions was never brought to Canada.

## The one honest caveat

The word "dysphagia" does **not** appear anywhere in either the 2019 or the 2020
Exservan prescribing information. Both label texts were extracted in full and
searched. The no-water, dissolves-on-the-tongue property is documented in the
label; a labelled dysphagia indication is not. Say "a film that dissolves on
the tongue without water", not "a film approved for dysphagia".

Likewise, `teglutik_ema_year` is deliberately null in our data. Teglutik is
nationally authorized in European member states, not centrally EMA-approved —
the EMA register lists only Rilutek (1996) and Riluzole Zentiva (2012) for
riluzole. Say "authorized in Europe nationally since 2013", not
"EMA-approved".

## The special-access route

Health Canada's Special Access Programme lets a licensed practitioner request a
drug "unavailable for sale in Canada" for a serious or life-threatening
condition where conventional treatments "have failed, are unsuitable or are
unavailable in Canada". That is the only legal path to a non-authorized riluzole
formulation for a Hamilton patient.

For the film this is now moot — FDA withdrew the NDA and production stopped in
2024, so an Exservan request would have no supplier. The suspension is the only
realistic special-access target. Note that this last point is an inference from
the withdrawal, not a Health Canada statement.

## Why this belongs in the pipeline rather than a footnote

The `canada` rule exists so the shortlist is something Alex's neurologist could
act on, and this is the case that proves the rule earns its place. Every other
stage of the pipeline asks whether a molecule could work. This stage asks
whether he can be handed it, and for his own current prescription the answer is
that the formulation he needs exists, is marketed in two other countries, and
stops at the border.

Run it:

```bash
python3 patient_filter.py --drug riluzole                    # fails swallow
python3 patient_filter.py --drug "riluzole oral suspension"  # clears swallow, fails canada
```

## Sources

- Health Canada DPD API, queried per drug_code for form, route and status:
  `https://health-products.canada.ca/api/drug/activeingredient/?lang=en&ingredientname=riluzole`
- Health Canada DPD bulk extracts (`allfiles.zip`, `allfiles_ap.zip`,
  `allfiles_dr.zip`, `allfiles_ia.zip`), updated 2026-11-02
- Exservan approval letter: https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2019/212640Orig1s000ltr.pdf
- Exservan label: https://www.accessdata.fda.gov/drugsatfda_docs/label/2020/212640s001lbl.pdf
- NDA 212640 withdrawal: https://www.federalregister.gov/documents/2025/01/15/2025-00743/teva-branded-pharmaceutical-products-randd-inc-et-al-withdrawal-of-approval-of-12-new-drug
- Exservan discontinuation: https://us.tanabe-pharma.com/news-and-media/press-releases/2024/mitsubishi-tanabe-pharma-america-to-discontinue-exservan-riluzole
- Health Canada Special Access Programme: https://www.canada.ca/en/health-canada/services/drugs-health-products/special-access/drugs.html

Full evidence trail, including per-endpoint API results and the extract search
methodology, is in the team store at
`internal/riluzole-formulation-regulatory-verification.md`.
