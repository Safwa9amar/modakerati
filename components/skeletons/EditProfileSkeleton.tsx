import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from "@/components/ui/Skeleton";

// Edit Profile is a form, and a form's skeleton has to be honest about its
// shape: the same six field slots in the same order, so the labels and inputs
// don't shuffle under the thumb when the profile arrives.

// label + control, matching TextInput's 6pt gap and 48pt control height.
function Field({ labelWidth = 84 }: { labelWidth?: number }) {
  return (
    <View style={styles.fieldGroup}>
      <SkeletonBlock width={labelWidth} height={11} radius={4} />
      <SkeletonBlock width="100%" height={48} radius={12} />
    </View>
  );
}

export function EditProfileSkeleton() {
  return (
    <SkeletonGroup style={styles.content} label="Loading profile">
      <View style={styles.avatarSection}>
        <SkeletonCircle size={100} />
        <SkeletonBlock width={104} height={12} style={styles.caption} />
      </View>

      <View style={styles.form}>
        <Field labelWidth={72} />
        <Field labelWidth={52} />
        <Field labelWidth={90} />
        <Field labelWidth={86} />

        {/* Level — three segments side by side, not an input. */}
        <View style={styles.fieldGroup}>
          <SkeletonBlock width={48} height={11} radius={4} />
          <View style={styles.segments}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} width="31%" height={42} radius={12} />
            ))}
          </View>
        </View>

        <Field labelWidth={104} />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  avatarSection: { alignItems: "center", marginBottom: 32 },
  caption: { marginTop: 12 },
  form: { gap: 18 },
  fieldGroup: { gap: 6 },
  segments: { flexDirection: "row", gap: 10 },
});
