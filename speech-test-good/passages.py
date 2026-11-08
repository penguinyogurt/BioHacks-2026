"""Fixed English passages. The recognizer never receives these as a decoding prompt."""
from engine import PASSAGE

PASSAGES = [
    ("Morning light", PASSAGE, PASSAGE.replace("morning ", "").replace("window", "door")),
    ("At the market", "We carried a basket to the market. The baker gave us a warm loaf of bread.",
     "We carried a bag to the market. The baker gave us a loaf of bread."),
    ("Along the river", "A small boat crossed the river. Two children waved from the bridge.",
     "A boat crossed the river. Two children waved from the shore."),
]
