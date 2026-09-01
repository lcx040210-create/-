# conftest.py  （放在 backend/ 根，让 pytest 能把 backend/ 加进 sys.path）
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
