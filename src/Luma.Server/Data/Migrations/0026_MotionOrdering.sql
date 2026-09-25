-- Reels asks for videos and animated GIFs together. That OR predicate cannot use the
-- single-MediaType ordering indexes, so it otherwise walks the all-media index past
-- photos until it finds enough motion items. Keep the indexes partial: motion is a
-- small part of a typical library, while every supported Reels ordering remains a seek.
CREATE INDEX IX_Media_MotionModified
ON Media(Availability,ModifiedTicks,Id)
WHERE MediaType='video' OR Extension='.gif';

CREATE INDEX IX_Media_MotionCaptured
ON Media(Availability,EffectiveTicks,Id)
WHERE MediaType='video' OR Extension='.gif';

CREATE INDEX IX_Media_MotionName
ON Media(Availability,NameKey,Id)
WHERE MediaType='video' OR Extension='.gif';

CREATE INDEX IX_Media_MotionType
ON Media(Availability,MediaType,Id)
WHERE MediaType='video' OR Extension='.gif';

CREATE INDEX IX_Media_MotionSize
ON Media(Availability,SizeBytes,Id)
WHERE MediaType='video' OR Extension='.gif';

CREATE INDEX IX_Media_MotionRandom
ON Media(Availability,RandomKey,Id)
WHERE MediaType='video' OR Extension='.gif';

-- Give the planner real cardinalities immediately on an existing large library.
ANALYZE Media;
