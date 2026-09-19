CREATE INDEX IX_Media_DateGroupCaptured ON Media(Availability,DateDay,EffectiveTicks,Id);
CREATE INDEX IX_Media_DateGroupName ON Media(Availability,DateDay,NameKey,Id);
CREATE INDEX IX_Media_DateGroupType ON Media(Availability,DateDay,MediaType,Id);
ANALYZE Media;
