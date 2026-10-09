# -*- coding: utf-8 -*-
"""v3, step 3b: page-fit trims after the count update (no facts removed)."""
from patch import run
FIT = [
("FIT-ex4end", """ Positions are on the exemption, not on the $2 billion figure. The "
                  "counts describe who wrote, not how the Commission will weigh each letter.")""",
 """ Positions are on the exemption, not on the $2 billion figure.")"""),
("FIT-31", """ Because those three also ask for a narrower exemption in some respect, "
            "Exhibit 4 counts all twelve as too broad.\"""",
 """ Exhibit 4 counts all twelve as too broad, as those "
            "three also seek a narrower exemption.\""""),
("FIT-2bn", """"Of the 51 that addressed the figure, 18 supported it, 16 wanted it "
             "lower, 4 higher and 12 opposed any increase; one gave no direction",""",
 """"Of the 50 that took a view on the figure, 18 supported it, 16 wanted "
             "it lower, 4 higher and 12 opposed any increase","""),
]
if __name__ == "__main__":
    run(FIT, "v3-fit")

FIT2 = [
("FIT-5close", """H.p("Commenters agree most on the on-ramp; changing it would not affect a seasoned mid-market "
            "company, but a second test or a lower threshold would. A count of letters shows where the "
            "arguments lie rather than how the Commission will vote.")))""",
 """H.p("Commenters agree most on the on-ramp, which would not affect a seasoned mid-market company; a "
            "second test or a lower threshold would. The counts show where the arguments lie, not the vote.")))"""),
]
if __name__ == "__main__" and "fit2" in __import__("sys").argv:
    run(FIT2, "v3-fit2")
